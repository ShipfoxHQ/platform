import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-core-dto';
import {createDebugIntegrationProvider} from '@shipfox/api-integration-debug';
import {
  type ConnectGithubInstallationInput,
  createGithubIntegrationProvider,
  db as githubDb,
  migrationsPath as githubMigrationsPath,
  upsertGithubInstallation,
} from '@shipfox/api-integration-github';
import type {ShipfoxModule} from '@shipfox/node-module';
import type {IntegrationProvider} from '#core/entities/provider.js';
import {
  createIntegrationProviderRegistry,
  type IntegrationProviderRegistry,
} from '#core/providers/registry.js';
import {
  createSourceControlIntegrationService,
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
  IntegrationProviderAdapters,
  IntegrationProviderKind,
  RegisteredIntegrationProvider,
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
export {createSourceControlIntegrationService} from '#core/source-control-service.js';

export interface CreateIntegrationsModuleOptions {
  providers?: IntegrationProvider[] | undefined;
}

export interface IntegrationsContext {
  module: ShipfoxModule;
  registry: IntegrationProviderRegistry;
  capabilities: {
    sourceControl: IntegrationSourceControlService;
  };
  sourceControl: IntegrationSourceControlService;
}

function createConfiguredProviders(): IntegrationProvider[] {
  const providers: IntegrationProvider[] = [];
  if (config.INTEGRATIONS_ENABLE_DEBUG_PROVIDER) {
    providers.push(createDebugIntegrationProvider({upsertIntegrationConnection}));
  }
  if (config.INTEGRATIONS_ENABLE_GITHUB_PROVIDER) {
    providers.push(
      createGithubIntegrationProvider({
        connectGithubInstallation,
      }),
    );
  }
  return providers;
}

async function connectGithubInstallation(
  input: ConnectGithubInstallationInput,
): Promise<CoreIntegrationConnection<'github'>> {
  return await db().transaction(async (tx) => {
    const connection = await upsertIntegrationConnection(
      {
        workspaceId: input.workspaceId,
        provider: 'github',
        externalAccountId: input.installationId,
        displayName: input.displayName,
        lifecycleStatus: 'active',
      },
      {tx},
    );

    await upsertGithubInstallation(
      {
        connectionId: connection.id,
        ...input.installation,
      },
      {tx},
    );

    return connection as CoreIntegrationConnection<'github'>;
  });
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
  const sourceControl = createSourceControlIntegrationService({
    registry,
    getIntegrationConnectionById,
  });

  const module: ShipfoxModule = {
    name: 'integrations',
    database: config.INTEGRATIONS_ENABLE_GITHUB_PROVIDER
      ? [
          {db, migrationsPath},
          {db: githubDb, migrationsPath: githubMigrationsPath},
        ]
      : {db, migrationsPath},
    routes: createIntegrationRoutes(registry, sourceControl),
  };

  return {module, registry, capabilities: {sourceControl}, sourceControl};
}

export const integrationsModule: ShipfoxModule = createIntegrationsModule();
