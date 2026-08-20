import type {ManagedModelProvider, WorkspaceProvidersPolicy} from '@shipfox/api-agent-dto';
import {AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import type {WorkspaceProviderPolicyOptions} from '#core/workspace-provider-policy.js';
import {createCustomModelProviderRoute} from './create-custom-model-provider.js';
import {createDeleteModelProviderConfigRoute} from './delete-model-provider-config.js';
import {createDiscoverCustomModelProviderModelsRoute} from './discover-custom-model-provider-models.js';
import {createDiscoverCustomModelProviderModelsBySlugRoute} from './discover-custom-model-provider-models-by-slug.js';
import {createListModelProviderCatalogRoute} from './list-model-provider-catalog.js';
import {listModelProviderConfigsRoute} from './list-model-provider-configs.js';
import {setDefaultHarnessRoute} from './set-default-harness.js';
import {createSetDefaultModelProviderRoute} from './set-default-model-provider.js';
import {createUpdateCustomModelProviderRoute} from './update-custom-model-provider.js';
import {createUpdateModelProviderDefaultModelRoute} from './update-model-provider-default-model.js';
import {createUpsertModelProviderConfigRoute} from './upsert-model-provider-config.js';

export function createAgentRoutes(
  secrets: AgentSecretsClient,
  options: {
    managedProvider?: ManagedModelProvider | undefined;
    workspaceProviders?: WorkspaceProvidersPolicy | undefined;
  } = {},
): RouteGroup[] {
  const workspaceProviderPolicy: WorkspaceProviderPolicyOptions = {
    workspaceProviders: options.workspaceProviders ?? 'enabled',
    managedProviderId: options.managedProvider?.id,
  };

  return [
    {
      prefix: '/workspaces/:workspaceId/agent',
      auth: AUTH_USER,
      routes: [
        listModelProviderConfigsRoute,
        createCustomModelProviderRoute(secrets, workspaceProviderPolicy),
        createDiscoverCustomModelProviderModelsRoute(workspaceProviderPolicy),
        createDiscoverCustomModelProviderModelsBySlugRoute(secrets, workspaceProviderPolicy),
        createUpdateCustomModelProviderRoute(secrets, workspaceProviderPolicy),
        createUpsertModelProviderConfigRoute(secrets, workspaceProviderPolicy),
        createUpdateModelProviderDefaultModelRoute(workspaceProviderPolicy),
        createDeleteModelProviderConfigRoute(secrets, workspaceProviderPolicy),
        setDefaultHarnessRoute,
        createSetDefaultModelProviderRoute(workspaceProviderPolicy),
      ],
    },
    {
      prefix: '/agent',
      auth: AUTH_USER,
      routes: [
        createListModelProviderCatalogRoute({
          managedProvider: options.managedProvider,
          workspaceProviders: options.workspaceProviders,
        }),
      ],
    },
  ];
}

export const agentRoutes = createAgentRoutes(undefined as unknown as AgentSecretsClient);
