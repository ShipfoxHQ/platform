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

/** Register Jira's curated webhook and replace local metadata as one serialized state transition. */
export async function registerJiraWebhook(
  params: RegisterJiraWebhookParams,
): Promise<{webhookId: number; webhookExpiresAt: Date}> {
  const withRegistrationLock = params.withRegistrationLock ?? withJiraInstallationLock;
  let callbackFailed = false;
  let registeredWebhookId: number | undefined;
  let previous: Awaited<ReturnType<typeof getJiraInstallationByConnectionId>>;
  let metadataPersisted = false;
  let cleanupSupersededWebhooks: (() => Promise<void>) | undefined;
  let result: {webhookId: number; webhookExpiresAt: Date};
  try {
    result = await withRegistrationLock(params.cloudId, async () => {
      try {
        const getInstallation = params.getInstallation ?? getJiraInstallationByConnectionId;
        previous = await getInstallation(params.connectionId);
        const registration = await params.jira.registerDynamicWebhook({
          accessToken: params.accessToken,
          cloudId: params.cloudId,
          url: params.webhookUrl,
        });
        registeredWebhookId = registration.webhookId;
        const now = params.now ?? (() => new Date());
        const webhookExpiresAt = new Date(now().getTime() + JIRA_WEBHOOK_TTL_MS);

        const updateInstallation = params.updateInstallation ?? updateJiraInstallationWebhook;
        const updateInput = {
          connectionId: params.connectionId,
          webhookIds: params.replaceExistingWebhooks
            ? [registration.webhookId]
            : [...new Set([registration.webhookId, ...(previous?.webhookIds ?? [])])],
          webhookExpiresAt,
        };
        const installation = await updateInstallation(updateInput);
        if (!installation)
          throw new Error('Jira webhook registration lost its installation record');
        metadataPersisted = true;
        await params.onRegistrationSuccess?.({});

        cleanupSupersededWebhooks = () =>
          finishSupersededWebhookCleanup(
            params,
            previous,
            registration.webhookId,
            webhookExpiresAt,
            params.replaceExistingWebhooks === true,
          );
        return {webhookId: registration.webhookId, webhookExpiresAt};
      } catch (error) {
        callbackFailed = true;
        if (registeredWebhookId !== undefined) {
          const deleted = await deleteNewWebhookAfterPersistenceFailure(
            params,
            registeredWebhookId,
          );
          if (metadataPersisted || !deleted) {
            await restorePreviousWebhookMetadata(
              params,
              previous,
              deleted ? undefined : registeredWebhookId,
            );
          }
        } else if (metadataPersisted) {
          await restorePreviousWebhookMetadata(params, previous);
        }
        await bestEffortRegistrationFailure(params);
        throw error;
      }
    });
  } catch (error) {
    if (!callbackFailed) {
      if (registeredWebhookId !== undefined) {
        const deleted = await deleteNewWebhookAfterPersistenceFailure(params, registeredWebhookId);
        if (metadataPersisted || !deleted) {
          await restorePreviousWebhookMetadata(
            params,
            previous,
            deleted ? undefined : registeredWebhookId,
          );
        }
      } else if (metadataPersisted) {
        await restorePreviousWebhookMetadata(params, previous);
      }
      await bestEffortRegistrationFailure(params);
    }
    throw error;
  }

  if (cleanupSupersededWebhooks) {
    try {
      await withRegistrationLock(params.cloudId, cleanupSupersededWebhooks);
    } catch (error) {
      logger().warn(
        {err: error, connectionId: params.connectionId},
        'Jira superseded webhook cleanup persistence failed',
      );
    }
  }

  return result;
}

async function finishSupersededWebhookCleanup(
  params: RegisterJiraWebhookParams,
  previous: Awaited<ReturnType<typeof getJiraInstallationByConnectionId>>,
  registeredWebhookId: number,
  webhookExpiresAt: Date,
  replaceExistingWebhooks: boolean,
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

  const retainedWebhookIds = replaceExistingWebhooks
    ? [registeredWebhookId]
    : [registeredWebhookId, ...failedCleanupIds];
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
  previous: Awaited<ReturnType<typeof getJiraInstallationByConnectionId>>,
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
