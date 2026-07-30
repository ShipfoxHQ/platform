import {
  INTEGRATION_EVENT_RECEIVED,
  INTEGRATION_SOURCE_COMMIT_PUSHED,
  INTEGRATION_SOURCE_REPOSITORY_UPDATED,
  type IntegrationEventReceivedEvent,
  type IntegrationsEventMap,
  type SourcePushPayload,
  type SourceRepositoryIdentity,
} from '@shipfox/api-integration-spi';
import {writeOutboxEvent, writeOutboxEvents} from '@shipfox/node-outbox';
import {lt} from 'drizzle-orm';
import {db} from './db.js';
import {integrationsOutbox} from './schema/outbox.js';
import {integrationsWebhookDeliveries} from './schema/webhook-deliveries.js';

type IntegrationDb = ReturnType<typeof db>;
type IntegrationTx = Parameters<Parameters<IntegrationDb['transaction']>[0]>[0];
type Executor = IntegrationDb | IntegrationTx;

function connectionDedupScope(connectionId: string): string {
  return `connection:${connectionId}`;
}

function providerDedupScope(provider: string): string {
  return `provider:${provider}`;
}

function receivedEventDedupScope(event: IntegrationEventReceivedEvent): string {
  if (event.provider === 'webhook') return connectionDedupScope(event.connectionId);
  return providerDedupScope(event.provider);
}

export interface PublishIntegrationEventReceivedParams {
  tx: Executor;
  event: IntegrationEventReceivedEvent;
}

export interface PublishIntegrationEventReceivedResult {
  published: boolean;
}

export async function publishIntegrationEventReceived(
  params: PublishIntegrationEventReceivedParams,
): Promise<PublishIntegrationEventReceivedResult> {
  const inserted = await params.tx
    .insert(integrationsWebhookDeliveries)
    .values({
      provider: params.event.provider,
      dedupScope: receivedEventDedupScope(params.event),
      deliveryId: params.event.deliveryId,
    })
    .onConflictDoNothing({
      target: [
        integrationsWebhookDeliveries.provider,
        integrationsWebhookDeliveries.dedupScope,
        integrationsWebhookDeliveries.deliveryId,
      ],
    })
    .returning({deliveryId: integrationsWebhookDeliveries.deliveryId});

  if (inserted.length === 0) return {published: false};

  await writeOutboxEvent(params.tx, integrationsOutbox, {
    type: INTEGRATION_EVENT_RECEIVED,
    payload: params.event,
  });

  return {published: true};
}

export interface PublishSourcePushParams {
  tx: IntegrationTx;
  provider: string;
  source: string;
  workspaceId: string;
  connectionId: string;
  connectionName: string;
  deliveryId: string;
  receivedAt: string;
  rawPayload: unknown;
  push: SourcePushPayload;
}

// Emits a single source-control push as two outbox rows: the generic
// `INTEGRATION_EVENT_RECEIVED` envelope with the raw provider payload for triggers, and the
// typed `INTEGRATION_SOURCE_COMMIT_PUSHED` event for domain modules. One delivery-dedup gates
// both, so a redelivered webhook writes nothing. Requires a transaction: the dedup insert and
// both outbox rows must commit or roll back together.
export async function publishSourcePush(
  params: PublishSourcePushParams,
): Promise<{published: boolean}> {
  const inserted = await params.tx
    .insert(integrationsWebhookDeliveries)
    .values({
      provider: params.provider,
      dedupScope: providerDedupScope(params.provider),
      deliveryId: params.deliveryId,
    })
    .onConflictDoNothing({
      target: [
        integrationsWebhookDeliveries.provider,
        integrationsWebhookDeliveries.dedupScope,
        integrationsWebhookDeliveries.deliveryId,
      ],
    })
    .returning({deliveryId: integrationsWebhookDeliveries.deliveryId});

  if (inserted.length === 0) return {published: false};

  await writeOutboxEvents<IntegrationsEventMap>(params.tx, integrationsOutbox, [
    {
      type: INTEGRATION_EVENT_RECEIVED,
      payload: {
        provider: params.provider,
        source: params.source,
        event: 'push',
        workspaceId: params.workspaceId,
        connectionId: params.connectionId,
        connectionName: params.connectionName,
        deliveryId: params.deliveryId,
        receivedAt: params.receivedAt,
        payload: params.rawPayload,
      },
    },
    {
      type: INTEGRATION_SOURCE_COMMIT_PUSHED,
      payload: {
        provider: params.provider,
        workspaceId: params.workspaceId,
        connectionId: params.connectionId,
        deliveryId: params.deliveryId,
        receivedAt: params.receivedAt,
        push: params.push,
      },
    },
  ]);

  return {published: true};
}

export interface PublishSourceRepositoryUpdatedParams {
  tx: IntegrationTx;
  provider: string;
  source: string;
  workspaceId: string;
  connectionId: string;
  connectionName: string;
  deliveryId: string;
  receivedAt: string;
  rawPayload: unknown;
  event: string;
  repositories: SourceRepositoryIdentity[];
}

// Emits the generic provider envelope for triggers and one typed repository event per
// normalized repository for domain modules. One delivery-dedup gates all rows, so a
// redelivered webhook writes nothing. Requires a transaction: the dedup insert and all
// outbox rows must commit or roll back together.
export async function publishSourceRepositoryUpdated(
  params: PublishSourceRepositoryUpdatedParams,
): Promise<{published: boolean}> {
  const inserted = await params.tx
    .insert(integrationsWebhookDeliveries)
    .values({
      provider: params.provider,
      dedupScope: providerDedupScope(params.provider),
      deliveryId: params.deliveryId,
    })
    .onConflictDoNothing({
      target: [
        integrationsWebhookDeliveries.provider,
        integrationsWebhookDeliveries.dedupScope,
        integrationsWebhookDeliveries.deliveryId,
      ],
    })
    .returning({deliveryId: integrationsWebhookDeliveries.deliveryId});

  if (inserted.length === 0) return {published: false};

  await writeOutboxEvents<IntegrationsEventMap>(params.tx, integrationsOutbox, [
    {
      type: INTEGRATION_EVENT_RECEIVED,
      payload: {
        provider: params.provider,
        source: params.source,
        event: params.event,
        workspaceId: params.workspaceId,
        connectionId: params.connectionId,
        connectionName: params.connectionName,
        deliveryId: params.deliveryId,
        receivedAt: params.receivedAt,
        payload: params.rawPayload,
      },
    },
    ...params.repositories.map(
      (
        repository,
      ): {
        type: typeof INTEGRATION_SOURCE_REPOSITORY_UPDATED;
        payload: IntegrationsEventMap[typeof INTEGRATION_SOURCE_REPOSITORY_UPDATED];
      } => ({
        type: INTEGRATION_SOURCE_REPOSITORY_UPDATED,
        payload: {
          provider: params.provider,
          workspaceId: params.workspaceId,
          connectionId: params.connectionId,
          deliveryId: params.deliveryId,
          receivedAt: params.receivedAt,
          repository,
        },
      }),
    ),
  ]);

  return {published: true};
}

export interface PublishSourceCommitPushedParams {
  provider: string;
  workspaceId: string;
  connectionId: string;
  deliveryId: string;
  receivedAt: string;
  push: SourcePushPayload;
}

// Emits ONLY the typed `INTEGRATION_SOURCE_COMMIT_PUSHED` event, intentionally skipping the
// `INTEGRATION_EVENT_RECEIVED` envelope so triggers do not run workflows, and skipping the
// delivery-dedup row so it is never suppressed. Used to force a definitions re-sync without
// simulating an inbound webhook.
export async function publishSourceCommitPushed(
  params: PublishSourceCommitPushedParams,
): Promise<void> {
  await writeOutboxEvent<IntegrationsEventMap>(db(), integrationsOutbox, {
    type: INTEGRATION_SOURCE_COMMIT_PUSHED,
    payload: {
      provider: params.provider,
      workspaceId: params.workspaceId,
      connectionId: params.connectionId,
      deliveryId: params.deliveryId,
      receivedAt: params.receivedAt,
      push: params.push,
    },
  });
}

export interface RecordDeliveryOnlyParams {
  tx: Executor;
  provider: string;
  deliveryId: string;
}

export async function claimWebhookDelivery(
  params: RecordDeliveryOnlyParams,
): Promise<{claimed: boolean}> {
  const inserted = await params.tx
    .insert(integrationsWebhookDeliveries)
    .values({
      provider: params.provider,
      dedupScope: providerDedupScope(params.provider),
      deliveryId: params.deliveryId,
    })
    .onConflictDoNothing({
      target: [
        integrationsWebhookDeliveries.provider,
        integrationsWebhookDeliveries.dedupScope,
        integrationsWebhookDeliveries.deliveryId,
      ],
    })
    .returning({deliveryId: integrationsWebhookDeliveries.deliveryId});
  return {claimed: inserted.length > 0};
}

export async function recordDeliveryOnly(params: RecordDeliveryOnlyParams): Promise<void> {
  await claimWebhookDelivery(params);
}

export interface PruneWebhookDeliveriesParams {
  olderThan: Date;
}

export async function pruneWebhookDeliveries(
  params: PruneWebhookDeliveriesParams,
): Promise<{deleted: number}> {
  const result = await db()
    .delete(integrationsWebhookDeliveries)
    .where(lt(integrationsWebhookDeliveries.receivedAt, params.olderThan));
  return {deleted: result.rowCount ?? 0};
}

export type PublishIntegrationEventReceivedFn = typeof publishIntegrationEventReceived;
export type PublishSourcePushFn = typeof publishSourcePush;
export type PublishSourceRepositoryUpdatedFn = typeof publishSourceRepositoryUpdated;
export type PublishSourceCommitPushedFn = typeof publishSourceCommitPushed;
export type ClaimWebhookDeliveryFn = typeof claimWebhookDelivery;
export type RecordDeliveryOnlyFn = typeof recordDeliveryOnly;
