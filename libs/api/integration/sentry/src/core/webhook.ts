import type {SentryIssueWebhookDto} from '@shipfox/api-integration-sentry-dto';
import type {
  GetIntegrationConnectionByIdFn,
  IntegrationTx,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
  SentryIssuePayload,
  UpdateIntegrationConnectionLifecycleStatusFn,
} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {SentryApiClient} from '#api/client.js';
import {
  SentryConnectionNotFoundError,
  SentryInstallationDeletedError,
  SentryInstallationNotFoundError,
  SentryInstallationUnclaimedError,
  SentryIntegrationProviderError,
} from '#core/errors.js';
import {hashAuthorizationCode, verifySentryInstallationBestEffort} from '#core/install.js';
import {
  claimSentryInstallationVerification,
  getSentryInstallationByInstallationUuid,
  markSentryInstallationDeleted,
  markSentryInstallationExchangeSucceeded,
  type SentryInstallation,
} from '#db/installations.js';

const SENTRY_SOURCE = 'sentry';
const DEFAULT_ISSUE_TITLE = 'Sentry issue';
const DELETED_STATUS = 'deleted';

export interface HandleSentryIssueEventParams {
  tx: IntegrationTx;
  deliveryId: string;
  payload: SentryIssueWebhookDto;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

// Publishes the mapped event for a verified issue delivery. Throws a typed
// SentryIssueDroppedError subclass when the delivery references state we cannot
// publish against (unknown/deleted installation, or an install not yet claimed
// into a workspace); the webhook layer records-and-drops those. Dedup of an
// already-seen delivery is handled inside publishIntegrationEventReceived.
export async function handleSentryIssueEvent(params: HandleSentryIssueEventParams): Promise<void> {
  const installationUuid = params.payload.installation.uuid;

  const installation = await getSentryInstallationByInstallationUuid(installationUuid, {
    tx: params.tx,
  });
  if (!installation) {
    throw new SentryInstallationNotFoundError(installationUuid);
  }
  if (installation.status === DELETED_STATUS) {
    throw new SentryInstallationDeletedError(installationUuid);
  }
  // A verified-but-unclaimed install has no workspace yet, so there is nothing to
  // publish an event against. This is the pre-claim drop window (counted/logged).
  if (!installation.connectionId) {
    throw new SentryInstallationUnclaimedError(installationUuid);
  }

  const connection = await params.getIntegrationConnectionById(installation.connectionId, {
    tx: params.tx,
  });
  if (!connection) {
    throw new SentryConnectionNotFoundError(installation.connectionId);
  }

  await params.publishIntegrationEventReceived({
    tx: params.tx,
    event: {
      provider: SENTRY_SOURCE,
      source: connection.slug,
      event: `issue.${params.payload.action}`,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      connectionName: connection.displayName,
      deliveryId: params.deliveryId,
      receivedAt: new Date().toISOString(),
      payload: normalizeIssuePayload(params.payload),
    },
  });
}

export interface HandleSentryInstallationCreatedParams {
  deliveryId: string;
  installationUuid: string;
  // From the signed payload; the webhook is authoritative so the slug is trusted
  // without a getInstallation round-trip. The code is the single-use grant.
  orgSlug: string | undefined;
  code: string | undefined;
  sentry: SentryApiClient;
  verifyInstall: boolean;
  getSentryInstallation: (input: {
    installationUuid: string;
  }) => Promise<SentryInstallation | undefined>;
  // Persists the verified-unclaimed row and records the delivery in one short
  // transaction, returning the persisted row.
  persistUnclaimedAndRecordDelivery: (input: {
    installationUuid: string;
    orgSlug: string;
    codeHash: string;
    deliveryId: string;
  }) => Promise<SentryInstallation>;
  // Records the delivery for dedup without persisting an install (reconcile/no-op
  // or missing claim input).
  recordDelivery: (deliveryId: string) => Promise<void>;
}

/**
 * The authoritative `installation.created` path. Whichever of webhook or browser
 * arrives first exchanges the single-use code and persists a verified-unclaimed
 * row; the other reconciles. The webhook writes a pending claim before the
 * exchange and a durable checkpoint after it succeeds. Only that checkpoint can
 * bypass the single-use exchange on retry. The installed transition and delivery
 * record commit in one transaction. Never logs the raw code.
 */
export async function handleSentryInstallationCreated(
  params: HandleSentryInstallationCreatedParams,
): Promise<void> {
  const existing = await params.getSentryInstallation({installationUuid: params.installationUuid});
  if (existing && (existing.status === 'installed' || existing.status === 'deleted')) {
    logger().debug(
      {deliveryId: params.deliveryId, installationUuid: params.installationUuid},
      'sentry webhook: installation.created for an existing row, reconciling',
    );
    await params.recordDelivery(params.deliveryId);
    return;
  }

  if (!params.code || !params.orgSlug) {
    logger().warn(
      {deliveryId: params.deliveryId, installationUuid: params.installationUuid},
      'sentry webhook: installation.created without claim input, dropping',
    );
    await params.recordDelivery(params.deliveryId);
    return;
  }

  const codeHash = hashAuthorizationCode(params.code);
  let claimed =
    existing ??
    (await claimSentryInstallationVerification({
      installationUuid: params.installationUuid,
      orgSlug: params.orgSlug,
      codeHash,
    }));
  if (claimed.status === 'installed' || claimed.status === 'deleted') {
    await params.recordDelivery(params.deliveryId);
    return;
  }
  if (claimed.codeHash !== codeHash) {
    logger().warn(
      {deliveryId: params.deliveryId, installationUuid: params.installationUuid},
      'sentry webhook: installation.created does not match the pending claim, dropping',
    );
    await params.recordDelivery(params.deliveryId);
    return;
  }

  let authorization: Awaited<ReturnType<SentryApiClient['exchangeAuthorizationCode']>> | undefined;
  if (claimed.status === 'pending') {
    try {
      authorization = await params.sentry.exchangeAuthorizationCode({
        installationUuid: params.installationUuid,
        code: params.code,
      });
    } catch (error) {
      if (!(error instanceof SentryIntegrationProviderError) || error.reason !== 'access-denied') {
        throw error;
      }

      const current = await params.getSentryInstallation({
        installationUuid: params.installationUuid,
      });
      const concurrentAttemptSucceeded =
        current?.codeHash === codeHash &&
        (current.status === 'exchange-succeeded' || current.status === 'installed');
      if (!current || !concurrentAttemptSucceeded) throw error;
      claimed = current;
    }

    if (authorization) {
      await markSentryInstallationExchangeSucceeded({
        installationUuid: params.installationUuid,
        codeHash,
      });
    }
  }

  const completed = await params.persistUnclaimedAndRecordDelivery({
    installationUuid: params.installationUuid,
    orgSlug: claimed.orgSlug,
    codeHash,
    deliveryId: params.deliveryId,
  });
  if (authorization && completed.status === 'installed' && params.verifyInstall) {
    await verifySentryInstallationBestEffort({
      sentry: params.sentry,
      installationUuid: params.installationUuid,
      token: authorization.token,
    });
  }
}

export interface HandleSentryInstallationDeletedParams {
  tx: IntegrationTx;
  deliveryId: string;
  installationUuid: string;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  updateConnectionLifecycleStatus: UpdateIntegrationConnectionLifecycleStatusFn;
}

// Tombstones the install and disables its connection if one exists. An unknown
// uuid also gets a tombstone, so a reordered creation cannot restore it. The
// state change and delivery record share the caller's transaction.
export async function handleSentryInstallationDeleted(
  params: HandleSentryInstallationDeletedParams,
): Promise<void> {
  const installation = await markSentryInstallationDeleted(
    {installationUuid: params.installationUuid},
    {tx: params.tx},
  );
  if (installation?.connectionId) {
    await params.updateConnectionLifecycleStatus(
      {id: installation.connectionId, lifecycleStatus: 'disabled'},
      {tx: params.tx},
    );
  }

  await params.recordDeliveryOnly({
    tx: params.tx,
    provider: SENTRY_SOURCE,
    deliveryId: params.deliveryId,
  });
}

// A raw Sentry `ignored` action is normalized to `archived` before validation,
// so legacy ignore events still fire `issue.archived` workflows.
export function normalizeSentryIssueAction(parsedJson: unknown): unknown {
  if (typeof parsedJson !== 'object' || parsedJson === null) return parsedJson;
  const obj = parsedJson as {action?: unknown};
  if (obj.action === 'ignored') {
    return {...obj, action: 'archived'};
  }
  return parsedJson;
}

function normalizeIssuePayload(payload: SentryIssueWebhookDto): SentryIssuePayload {
  const issue = payload.data.issue;
  return {
    action: payload.action,
    issueId: issue.id,
    shortId: issue.shortId ?? null,
    title: issue.title ?? DEFAULT_ISSUE_TITLE,
    culprit: issue.culprit ?? null,
    level: issue.level ?? null,
    status: issue.status ?? null,
    platform: issue.platform ?? null,
    webUrl: issue.web_url ?? null,
    issueUrl: issue.url ?? null,
    projectUrl: issue.project_url ?? null,
    firstSeenAt: issue.firstSeen ?? null,
    lastSeenAt: issue.lastSeen ?? null,
  };
}
