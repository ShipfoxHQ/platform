import type {
  CreateIntegrationConnectionFn,
  DeleteIntegrationConnectionFn,
  GetIntegrationConnectionByIdFn,
  IntegrationConnection,
  IntegrationTx,
  PublishIntegrationEventReceivedFn,
  UpdateIntegrationConnectionLifecycleStatusFn,
} from '@shipfox/api-integration-spi';
import {WEBHOOK_PROVIDER, webhookEventCatalog} from '@shipfox/api-integration-webhook-dto';
import {config} from '#config.js';
import {createGenericWebhookProcessor} from '#core/webhook-processor.js';
import {createWebhookConnectionRoutes} from '#presentation/routes/connections.js';
import {createWebhookInboundRoutes} from '#presentation/routes/inbound.js';

export {redactHeaders, WEBHOOK_FORWARDED_HEADERS, WEBHOOK_INBOUND_BODY_LIMIT} from '#constants.js';
export type {
  CreateGenericWebhookProcessorOptions,
  GenericWebhookProcessor,
} from '#core/webhook-processor.js';
export {createGenericWebhookProcessor} from '#core/webhook-processor.js';

export interface CreateWebhookIntegrationProviderOptions {
  coreDb: () => {
    transaction<T>(callback: (tx: IntegrationTx) => Promise<T>): Promise<T>;
  };
  createIntegrationConnection: CreateIntegrationConnectionFn;
  listIntegrationConnections: (params: {workspaceId: string}) => Promise<IntegrationConnection[]>;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  updateIntegrationConnectionLifecycleStatus: UpdateIntegrationConnectionLifecycleStatusFn;
  deleteIntegrationConnection: DeleteIntegrationConnectionFn;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  baseUrl?: string | undefined;
}

export function createWebhookIntegrationProvider(options: CreateWebhookIntegrationProviderOptions) {
  const baseUrl = options.baseUrl ?? config.WEBHOOK_PUBLIC_URL;
  const webhookProcessor = createGenericWebhookProcessor(options);
  return {
    provider: WEBHOOK_PROVIDER,
    displayName: 'Webhook',
    eventCatalog: webhookEventCatalog,
    routes: [
      createWebhookConnectionRoutes({
        baseUrl,
        createIntegrationConnection: options.createIntegrationConnection,
        listIntegrationConnections: options.listIntegrationConnections,
        getIntegrationConnectionById: options.getIntegrationConnectionById,
        updateIntegrationConnectionLifecycleStatus:
          options.updateIntegrationConnectionLifecycleStatus,
        deleteIntegrationConnection: options.deleteIntegrationConnection,
      }),
      createWebhookInboundRoutes({
        coreDb: options.coreDb,
        getIntegrationConnectionById: options.getIntegrationConnectionById,
        publishIntegrationEventReceived: options.publishIntegrationEventReceived,
        processor: webhookProcessor,
      }),
    ],
    webhookProcessors: [{routeIds: ['webhook.connection'] as const, processor: webhookProcessor}],
  };
}
