import type {
  IntegrationConnection as CoreIntegrationConnection,
  IntegrationProvider as CoreIntegrationProvider,
  SourceControlProvider as CoreSourceControlProvider,
  IntegrationConnectionLifecycleStatus,
  IntegrationProviderAdapters,
  ListRepositoriesInput,
  RepositoryPage,
  RepositorySnapshot,
  RepositoryVisibility,
  ResolveRepositoryInput,
} from '@shipfox/api-integration-core-dto';
import type {RouteExport} from '@shipfox/node-fastify';

export type IntegrationProviderKind = 'github';
export type IntegrationConnection = CoreIntegrationConnection<IntegrationProviderKind>;
export type SourceControlProvider = CoreSourceControlProvider<IntegrationConnection>;
export type IntegrationProvider = CoreIntegrationProvider<
  IntegrationProviderKind,
  RouteExport,
  IntegrationConnection
>;

export type {
  IntegrationConnectionLifecycleStatus,
  IntegrationProviderAdapters,
  ListRepositoriesInput,
  RepositoryPage,
  RepositorySnapshot,
  RepositoryVisibility,
  ResolveRepositoryInput,
};
