import {
  type GiteaPushPayloadDto,
  giteaProviderKind,
  giteaPushPayloadSchema,
  giteaWebhookEventNames,
} from '@shipfox/api-integration-gitea-dto';
import {
  buildProviderRepositoryId,
  type GetIntegrationConnectionByIdFn,
  type IntegrationTx,
  type PublishSourcePushFn,
  type RecordDeliveryOnlyFn,
  type SourcePushPayload,
} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import {getGiteaConnectionByOrg} from '#db/connections.js';

const REFS_HEADS_PREFIX = 'refs/heads/';
// Gitea sends a `push` webhook for a branch deletion with `after` set to this all-zero SHA.
const DELETED_BRANCH_SHA = '0'.repeat(40);

export class GiteaWebhookMalformedJsonError extends Error {
  constructor(options: {cause: unknown}) {
    super('Gitea webhook payload is not valid JSON', {cause: options.cause});
    this.name = 'GiteaWebhookMalformedJsonError';
  }
}

export class GiteaWebhookMalformedPushPayloadError extends Error {
  constructor(public readonly issues: unknown) {
    super('Gitea webhook push payload failed schema validation');
    this.name = 'GiteaWebhookMalformedPushPayloadError';
  }
}

export interface HandleGiteaWebhookParams {
  tx: IntegrationTx;
  deliveryId: string;
  event: string;
  rawBody: string;
  publishSourcePush: PublishSourcePushFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export interface HandleGiteaPushParams {
  tx: IntegrationTx;
  deliveryId: string;
  payload: GiteaPushPayloadDto;
  rawPayload: unknown;
  publishSourcePush: PublishSourcePushFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export type HandleGiteaPushOutcome =
  | 'published'
  | 'duplicate'
  | 'deleted'
  | 'unknown-org'
  | 'inactive-connection';
export type HandleGiteaWebhookOutcome = HandleGiteaPushOutcome | 'recorded-only';

function isBranchDeletion(after: string): boolean {
  return after === DELETED_BRANCH_SHA;
}

export async function handleGiteaWebhook(
  params: HandleGiteaWebhookParams,
): Promise<{outcome: HandleGiteaWebhookOutcome}> {
  if (!giteaWebhookEventNames.some((eventName) => eventName === params.event)) {
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: giteaProviderKind,
      deliveryId: params.deliveryId,
    });
    return {outcome: 'recorded-only'};
  }

  const {payload, rawPayload} = parseGiteaPushPayload(params.rawBody);
  return handleGiteaPush({
    tx: params.tx,
    deliveryId: params.deliveryId,
    payload,
    rawPayload,
    publishSourcePush: params.publishSourcePush,
    recordDeliveryOnly: params.recordDeliveryOnly,
    getIntegrationConnectionById: params.getIntegrationConnectionById,
  });
}

export async function handleGiteaPush(
  params: HandleGiteaPushParams,
): Promise<{outcome: HandleGiteaPushOutcome}> {
  // Dropping deletes before `publishSourcePush` avoids project and trigger fan-out.
  if (isBranchDeletion(params.payload.after)) {
    return {outcome: 'deleted'};
  }

  const owner = params.payload.repository.owner.username;
  // Gitea org routes are case-insensitive, and the connect flow stores them lower-cased.
  const giteaConnection = await getGiteaConnectionByOrg(owner.toLowerCase(), {tx: params.tx});
  if (!giteaConnection) {
    logger().warn(
      {deliveryId: params.deliveryId, org: owner},
      'gitea webhook: unknown org, dropping',
    );
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: giteaProviderKind,
      deliveryId: params.deliveryId,
    });
    return {outcome: 'unknown-org'};
  }

  const connection = await params.getIntegrationConnectionById(giteaConnection.connectionId, {
    tx: params.tx,
  });
  if (!connection) {
    logger().warn(
      {deliveryId: params.deliveryId, org: owner, connectionId: giteaConnection.connectionId},
      'gitea webhook: org has no connection, dropping',
    );
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: giteaProviderKind,
      deliveryId: params.deliveryId,
    });
    return {outcome: 'unknown-org'};
  }

  if (connection.lifecycleStatus !== 'active') {
    const logContext = {
      deliveryId: params.deliveryId,
      org: owner,
      connectionId: connection.id,
      workspaceId: connection.workspaceId,
      lifecycleStatus: connection.lifecycleStatus,
    };
    // `disabled` is an expected steady state; only `error` is anomalous.
    if (connection.lifecycleStatus === 'error') {
      logger().warn(logContext, 'gitea webhook: connection in error state, dropping');
    } else {
      logger().info(logContext, 'gitea webhook: connection disabled, dropping');
    }
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: giteaProviderKind,
      deliveryId: params.deliveryId,
    });
    return {outcome: 'inactive-connection'};
  }

  const ref = stripRefsHeads(params.payload.ref);
  const defaultBranch = params.payload.repository.default_branch;
  const push: SourcePushPayload = {
    // Match the source-control adapter's owner/name repository id.
    externalRepositoryId: buildProviderRepositoryId(
      giteaProviderKind,
      `${owner}/${params.payload.repository.name}`,
    ),
    ref,
    headCommitSha: params.payload.after,
    defaultBranch,
    isDefaultBranch: ref === defaultBranch,
  };
  const result = await params.publishSourcePush({
    tx: params.tx,
    provider: giteaProviderKind,
    source: connection.slug,
    workspaceId: connection.workspaceId,
    connectionId: connection.id,
    connectionName: connection.displayName,
    deliveryId: params.deliveryId,
    receivedAt: new Date().toISOString(),
    rawPayload: params.rawPayload,
    push,
  });

  return {outcome: result.published ? 'published' : 'duplicate'};
}

function stripRefsHeads(ref: string): string {
  return ref.startsWith(REFS_HEADS_PREFIX) ? ref.slice(REFS_HEADS_PREFIX.length) : ref;
}

function parseGiteaPushPayload(rawBody: string): {
  payload: GiteaPushPayloadDto;
  rawPayload: unknown;
} {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch (error) {
    throw new GiteaWebhookMalformedJsonError({cause: error});
  }

  const validated = giteaPushPayloadSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new GiteaWebhookMalformedPushPayloadError(validated.error.issues);
  }

  return {payload: validated.data, rawPayload: parsedJson};
}
