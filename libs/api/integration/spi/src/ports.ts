import type {
  IntegrationEventReceivedEvent,
  SourcePushPayload,
  SourceRepositoryIdentity,
} from '@shipfox/api-integration-core-dto';
import type {IntegrationConnection, IntegrationConnectionLifecycleStatus} from '#contracts.js';

// biome-ignore lint/suspicious/noExplicitAny: cross-package transaction handles stay opaque to provider packages
export type IntegrationTx = any;

export type PublishIntegrationEventReceivedFn = (params: {
  tx: IntegrationTx;
  event: IntegrationEventReceivedEvent;
}) => Promise<{published: boolean}>;

export type CreateIntegrationConnectionFn = (
  params: {
    workspaceId: string;
    provider: string;
    externalAccountId: string;
    slug: string;
    displayName: string;
    lifecycleStatus?: IntegrationConnectionLifecycleStatus | undefined;
  },
  options?: {tx?: IntegrationTx},
) => Promise<IntegrationConnection>;

export type PublishSourcePushFn = (params: {
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
}) => Promise<{published: boolean}>;

export type PublishSourceRepositoryUpdatedFn = (params: {
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
}) => Promise<{published: boolean}>;

export type RecordDeliveryOnlyFn = (params: {
  tx: IntegrationTx;
  provider: string;
  deliveryId: string;
}) => Promise<void>;

export type ClaimWebhookDeliveryFn = (params: {
  tx: IntegrationTx;
  provider: string;
  deliveryId: string;
}) => Promise<{claimed: boolean}>;

export type GetIntegrationConnectionByIdFn = (
  id: string,
  options?: {tx?: IntegrationTx},
) => Promise<IntegrationConnection | undefined>;

export type UpdateIntegrationConnectionLifecycleStatusFn = (
  params: {id: string; lifecycleStatus: IntegrationConnectionLifecycleStatus},
  options?: {tx?: IntegrationTx},
) => Promise<IntegrationConnection | undefined>;

export type DeleteIntegrationConnectionFn = (
  params: {id: string},
  options?: {tx?: IntegrationTx},
) => Promise<boolean>;
