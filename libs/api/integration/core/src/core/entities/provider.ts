import type {
  IntegrationProvider as CoreIntegrationProvider,
  RegisteredIntegrationProvider as CoreRegisteredIntegrationProvider,
} from '@shipfox/api-integration-core-dto';
import type {RouteExport} from '@shipfox/node-fastify';

export type {
  IntegrationCapability,
  IntegrationProviderAdapters,
  IntegrationProviderKind,
} from '@shipfox/api-integration-core-dto';

export type IntegrationProvider = CoreIntegrationProvider<string, RouteExport>;
export type RegisteredIntegrationProvider = CoreRegisteredIntegrationProvider<string, RouteExport>;
