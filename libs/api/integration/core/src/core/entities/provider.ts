import type {
  IntegrationProvider as CoreIntegrationProvider,
  RegisteredIntegrationProvider as CoreRegisteredIntegrationProvider,
  WebhookRequestProcessor,
  WebhookRouteId,
} from '@shipfox/api-integration-spi';
import type {RouteExport} from '@shipfox/node-fastify';

export type {
  AgentToolCallInput,
  AgentToolCatalogEntry,
  AgentToolJsonSchema,
  AgentToolRepositoryAuthorizationState,
  AgentToolSensitivity,
  AgentToolSession,
  AgentToolsProvider,
  IntegrationCapability,
  IntegrationProviderAdapters,
  IntegrationProviderKind,
  OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-spi';

export type IntegrationProvider = CoreIntegrationProvider<string, RouteExport> & {
  webhookProcessors?:
    | Array<{routeIds: readonly WebhookRouteId[]; processor: WebhookRequestProcessor}>
    | undefined;
};
export type RegisteredIntegrationProvider = CoreRegisteredIntegrationProvider<string, RouteExport>;
