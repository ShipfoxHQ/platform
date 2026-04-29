import {createDebugIntegrationProvider} from '@shipfox/api-integration-debug';
import type {ShipfoxModule} from '@shipfox/node-module';
import type {IntegrationProvider} from '#core/providers/provider.js';
import {createIntegrationProviderRegistry} from '#core/providers/registry.js';
import {upsertIntegrationConnection} from '#db/connections.js';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {createIntegrationRoutes} from '#presentation/routes/index.js';
import {config} from './config.js';

export type {
  IntegrationCapability,
  IntegrationConnection,
  IntegrationConnectionLifecycleStatus,
  IntegrationProviderKind,
} from '#core/entities/connection.js';
export type {IntegrationProviderErrorReason} from '#core/errors.js';
export {IntegrationProviderError} from '#core/errors.js';
export type {IntegrationProvider} from '#core/providers/provider.js';
export type {IntegrationProviderRegistry} from '#core/providers/registry.js';
export type {
  ListRepositoriesInput,
  RepositoryPage,
  RepositorySnapshot,
  RepositoryVisibility,
  ResolveRepositoryInput,
  SourceControlProvider,
} from '#core/providers/source-control.js';

export interface CreateIntegrationsModuleOptions {
  providers?: IntegrationProvider[] | undefined;
}

function createConfiguredProviders(): IntegrationProvider[] {
  const providers: IntegrationProvider[] = [];
  if (config.INTEGRATIONS_ENABLE_DEBUG_PROVIDER) {
    providers.push(createDebugIntegrationProvider({upsertIntegrationConnection}));
  }
  return providers;
}

export function createIntegrationsModule(
  options: CreateIntegrationsModuleOptions = {},
): ShipfoxModule {
  const registry = createIntegrationProviderRegistry(
    options.providers ?? createConfiguredProviders(),
  );

  return {
    name: 'integrations',
    database: {db, migrationsPath},
    routes: createIntegrationRoutes(registry),
  };
}

export const integrationsModule: ShipfoxModule = createIntegrationsModule();
