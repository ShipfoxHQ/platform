import {logger} from '@shipfox/node-opentelemetry';
import type {JiraApiClient} from '#api/client.js';
import {
  getJiraInstallationByConnectionId,
  type JiraInstallationLock,
  updateJiraInstallationWebhook,
  withJiraInstallationLock,
} from '#db/installations.js';

export const JIRA_WEBHOOK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface RegisterJiraWebhookParams {
  jira: Pick<JiraApiClient, 'registerDynamicWebhook' | 'deleteDynamicWebhook'>;
  connectionId: string;
  cloudId: string;
  accessToken: string;
  webhookUrl: string;
  now?: () => Date;
  getInstallation?: typeof getJiraInstallationByConnectionId;
  updateInstallation?: typeof updateJiraInstallationWebhook;
  withRegistrationLock?: JiraInstallationLock;
  replaceExistingWebhooks?: boolean | undefined;
  onRegistrationSuccess?: (input: {tx?: unknown}) => Promise<void>;
  onRegistrationFailure?: (input: {tx?: unknown}) => Promise<void>;
}

type JiraInstallation = Awaited<ReturnType<typeof getJiraInstallationByConnectionId>>;

interface JiraWebhookRegistrationState {
  callbackFailed: boolean;
  registeredWebhookId: number | undefined;
  previous: JiraInstallation;
  metadataPersisted: boolean;
  cleanupSupersededWebhooks: (() => Promise<void>) | undefined;
}

/** Register Jira's curated webhook and replace local metadata as one serialized state transition. */
export async function registerJiraWebhook(
  params: RegisterJiraWebhookParams,
): Promise<{webhookId: number; webhookExpiresAt: Date}> {
  const withRegistrationLock = params.withRegistrationLock ?? withJiraInstallationLock;
  const state: JiraWebhookRegistrationState = {
    callbackFailed: false,
    registeredWebhookId: undefined,
    previous: undefined,
    metadataPersisted: false,
    cleanupSupersededWebhooks: undefined,
  };
  let result: {webhookId: number; webhookExpiresAt: Date};
  try {
    result = await withRegistrationLock(params.cloudId, () =>
      registerJiraWebhookWithLock(params, state),
    );
  } catch (error) {
    if (!state.callbackFailed) await compensateFailedRegistration(params, state);
    throw error;
  }

  await runSupersededWebhookCleanup(params, withRegistrationLock, state);

  return result;
}

async function registerJiraWebhookWithLock(
  params: RegisterJiraWebhookParams,
  state: JiraWebhookRegistrationState,
): Promise<{webhookId: number; webhookExpiresAt: Date}> {
  try {
    const getInstallation = params.getInstallation ?? getJiraInstallationByConnectionId;
    state.previous = await getInstallation(params.connectionId);
    const registration = await params.jira.registerDynamicWebhook({
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      url: params.webhookUrl,
    });
    state.registeredWebhookId = registration.webhookId;
    const now = params.now ?? (() => new Date());
    const webhookExpiresAt = new Date(now().getTime() + JIRA_WEBHOOK_TTL_MS);
    await persistJiraWebhookRegistration(params, state, registration.webhookId, webhookExpiresAt);
    state.cleanupSupersededWebhooks = () =>
      finishSupersededWebhookCleanup(
        params,
        state.previous,
        registration.webhookId,
        webhookExpiresAt,
      );
    return {webhookId: registration.webhookId, webhookExpiresAt};
  } catch (error) {
    state.callbackFailed = true;
    await compensateFailedRegistration(params, state);
    throw error;
  }
}

async function persistJiraWebhookRegistration(
  params: RegisterJiraWebhookParams,
  state: JiraWebhookRegistrationState,
  webhookId: number,
  webhookExpiresAt: Date,
): Promise<void> {
  const updateInstallation = params.updateInstallation ?? updateJiraInstallationWebhook;
  const previousWebhookIds = state.previous?.webhookIds ?? [];
  const webhookIds = params.replaceExistingWebhooks
    ? [webhookId]
    : [...new Set([webhookId, ...previousWebhookIds])];
  const installation = await updateInstallation({
    connectionId: params.connectionId,
    webhookIds,
    webhookExpiresAt,
  });
  if (!installation) throw new Error('Jira webhook registration lost its installation record');
  state.metadataPersisted = true;
  await params.onRegistrationSuccess?.({});
}

async function compensateFailedRegistration(
  params: RegisterJiraWebhookParams,
  state: JiraWebhookRegistrationState,
): Promise<void> {
  if (state.registeredWebhookId !== undefined) {
    const deleted = await deleteNewWebhookAfterPersistenceFailure(
      params,
      state.registeredWebhookId,
    );
    if (state.metadataPersisted || !deleted) {
      await restorePreviousWebhookMetadata(
        params,
        state.previous,
        deleted ? undefined : state.registeredWebhookId,
      );
    }
  } else if (state.metadataPersisted) {
    await restorePreviousWebhookMetadata(params, state.previous);
  }
  await bestEffortRegistrationFailure(params);
}

async function runSupersededWebhookCleanup(
  params: RegisterJiraWebhookParams,
  withRegistrationLock: JiraInstallationLock,
  state: JiraWebhookRegistrationState,
): Promise<void> {
  if (!state.cleanupSupersededWebhooks) return;
  try {
    await withRegistrationLock(params.cloudId, state.cleanupSupersededWebhooks);
  } catch (error) {
    logger().warn(
      {err: error, connectionId: params.connectionId},
      'Jira superseded webhook cleanup persistence failed',
    );
  }
}

async function finishSupersededWebhookCleanup(
  params: RegisterJiraWebhookParams,
  previous: JiraInstallation,
  registeredWebhookId: number,
  webhookExpiresAt: Date,
): Promise<void> {
  const supersededWebhookIds = (previous?.webhookIds ?? []).filter(
    (webhookId) => webhookId !== registeredWebhookId,
  );
  if (supersededWebhookIds.length === 0) return;

  const failedCleanupIds: number[] = [];
  for (const webhookId of supersededWebhookIds) {
    try {
      await params.jira.deleteDynamicWebhook({
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        webhookId,
      });
    } catch (error) {
      failedCleanupIds.push(webhookId);
      logger().warn(
        {err: error, connectionId: params.connectionId, webhookId},
        'Jira superseded webhook cleanup failed',
      );
    }
  }

  const retainedWebhookIds = [registeredWebhookId, ...failedCleanupIds];
  const updateInstallation = params.updateInstallation ?? updateJiraInstallationWebhook;
  const cleanupMetadata = await updateInstallation({
    connectionId: params.connectionId,
    webhookIds: retainedWebhookIds,
    webhookExpiresAt,
  });
  if (!cleanupMetadata)
    throw new Error('Jira webhook cleanup metadata persistence returned no installation');
}

async function bestEffortRegistrationFailure(params: RegisterJiraWebhookParams): Promise<void> {
  try {
    await params.onRegistrationFailure?.({});
  } catch (error) {
    logger().warn(
      {err: error, connectionId: params.connectionId},
      'Jira connection error-state update failed after webhook registration rejection',
    );
  }
}

async function restorePreviousWebhookMetadata(
  params: RegisterJiraWebhookParams,
  previous: JiraInstallation,
  retainedWebhookId?: number,
): Promise<void> {
  try {
    const updateInstallation = params.updateInstallation ?? updateJiraInstallationWebhook;
    await updateInstallation({
      connectionId: params.connectionId,
      webhookIds: [
        ...(retainedWebhookId === undefined ? [] : [retainedWebhookId]),
        ...(previous?.webhookIds ?? []).filter((webhookId) => webhookId !== retainedWebhookId),
      ],
      webhookExpiresAt: previous?.webhookExpiresAt ?? null,
    });
  } catch (error) {
    logger().warn(
      {err: error, connectionId: params.connectionId},
      'Jira webhook metadata restoration failed after registration rejection',
    );
  }
}

async function deleteNewWebhookAfterPersistenceFailure(
  params: RegisterJiraWebhookParams,
  webhookId: number,
): Promise<boolean> {
  try {
    await params.jira.deleteDynamicWebhook({
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      webhookId,
    });
    return true;
  } catch (cleanupError) {
    logger().warn(
      {err: cleanupError, connectionId: params.connectionId, webhookId},
      'Jira webhook cleanup failed after metadata persistence rejection',
    );
    return false;
  }
}
