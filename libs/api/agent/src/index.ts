import type {ManagedModelProvider} from '@shipfox/api-agent-dto';
import type {ShipfoxModule} from '@shipfox/node-module';
import {assertAgentConfig} from '#config.js';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import {db, migrationsPath} from '#db/index.js';
import {createAgentE2eRoutes} from '#presentation/e2eRoutes/index.js';
import {createAgentInterModulePresentation} from '#presentation/inter-module.js';
import {createAgentRoutes} from '#presentation/routes/index.js';

export {
  type AgentConfigResolutionContext,
  type AgentDefaultsResolver,
  type AgentWorkspaceSettings,
  buildModelProviderCatalog,
  type ContextualAgentConfig,
  catalogDefaultAgentResolver,
  createCustomModelProviderConfig,
  createWorkspaceAgentDefaultsResolver,
  deleteModelProviderConfig,
  getModelProviderCredentialKeys,
  getModelProviderEntry,
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  isReservedModelProviderId,
  listSupportedModelProviders,
  type ModelProviderConfig,
  ModelProviderConfigNotFoundError,
  ModelProviderValidationError,
  ModelProviderValidationUnavailableError,
  modelProviderCredentialKeysMatch,
  type ResolvedAgentConfig,
  type ResolveRuntimeCredentialsParams,
  resolveAgentConfig,
  resolveRuntimeCredentials,
  testAndSaveModelProviderConfig,
  UnsupportedModelProviderError,
  updateCustomModelProviderConfig,
} from '#core/index.js';
export {
  getAgentWorkspaceSettings,
  getModelProviderConfig,
  listModelProviderConfigs,
  setDefaultModelProvider,
  upsertModelProviderConfig,
} from '#db/index.js';

export function createAgentModule(params: {
  secrets: AgentSecretsClient;
  managedProvider?: ManagedModelProvider | undefined;
}): ShipfoxModule {
  assertAgentConfig(params.managedProvider);

  return {
    name: 'agent',
    database: {db, migrationsPath, databaseNamespace: 'agent'},
    routes: createAgentRoutes(params.secrets),
    e2eRoutes: [createAgentE2eRoutes(params.secrets)],
    interModulePresentations: [createAgentInterModulePresentation(params)],
  };
}
