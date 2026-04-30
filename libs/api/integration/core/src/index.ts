import {createDebugIntegrationProvider} from '@shipfox/api-integration-debug';
import type {ShipfoxModule} from '@shipfox/node-module';
import type {IntegrationProvider} from '#core/entities/provider.js';
import {createIntegrationProviderRegistry} from '#core/providers/registry.js';
import {
  createIntegrationSourceControlService,
  type IntegrationSourceControlService,
} from '#core/source-control-service.js';
import {getIntegrationConnectionById, upsertIntegrationConnection} from '#db/connections.js';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {createIntegrationRoutes} from '#presentation/routes/index.js';
import {config} from './config.js';

export type {
  IntegrationConnection,
  IntegrationConnectionLifecycleStatus,
} from '#core/entities/connection.js';
export type {
  IntegrationCapability,
  IntegrationProvider,
  IntegrationProviderKind,
} from '#core/entities/provider.js';
export type {IntegrationProviderErrorReason} from '#core/errors.js';
export {
  IntegrationCapabilityUnavailableError,
  IntegrationConnectionInactiveError,
  IntegrationConnectionNotFoundError,
  IntegrationConnectionWorkspaceMismatchError,
  IntegrationProviderError,
  IntegrationProviderUnavailableError,
} from '#core/errors.js';
export type {IntegrationProviderRegistry} from '#core/providers/registry.js';
export type {
  ListRepositoriesInput,
  RepositoryPage,
  RepositorySnapshot,
  RepositoryVisibility,
  ResolveRepositoryInput,
  SourceControlProvider,
} from '#core/providers/source-control.js';
export type {IntegrationSourceControlService} from '#core/source-control-service.js';

export interface CreateIntegrationsModuleOptions {
  providers?: IntegrationProvider[] | undefined;
}

export interface IntegrationsContext {
  module: ShipfoxModule;
  sourceControl: IntegrationSourceControlService;
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
  return createIntegrationsContext(options).module;
}

export function createIntegrationsContext(
  options: CreateIntegrationsModuleOptions = {},
): IntegrationsContext {
  const registry = createIntegrationProviderRegistry(
    options.providers ?? createConfiguredProviders(),
  );
  const sourceControl = createIntegrationSourceControlService({
    registry,
    getIntegrationConnectionById,
  });

  const module: ShipfoxModule = {
    name: 'integrations',
    database: {db, migrationsPath},
    routes: createIntegrationRoutes(registry, sourceControl),
  };

  return {module, sourceControl};
}

export const integrationsModule: ShipfoxModule = createIntegrationsModule();
