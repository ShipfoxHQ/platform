import {
  discoverCustomModelProviderModelsBySlugBodySchema,
  discoverCustomModelProviderModelsResponseSchema,
  modelProviderRefSchema,
} from '@shipfox/api-agent-dto';
import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  assertWorkspaceProviderConfigurationEnabled,
  discoverCustomModelProviderModels,
  resolveCustomModelProviderDiscoveryParams,
} from '#core/index.js';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import type {WorkspaceProviderPolicyOptions} from '#core/workspace-provider-policy.js';
import {translateModelProviderRouteError} from './errors.js';

export function createDiscoverCustomModelProviderModelsBySlugRoute(
  secrets: AgentSecretsClient,
  workspaceProviderPolicy: WorkspaceProviderPolicyOptions = {workspaceProviders: 'enabled'},
) {
  return defineRoute({
    method: 'POST',
    path: '/custom-model-providers/:slug/discover-models',
    description: 'Discover models for a stored custom model provider configuration',
    schema: {
      params: z.object({
        workspaceId: z.string().uuid(),
        slug: modelProviderRefSchema,
      }),
      body: discoverCustomModelProviderModelsBySlugBodySchema,
      response: {
        200: discoverCustomModelProviderModelsResponseSchema,
      },
    },
    errorHandler: translateModelProviderRouteError,
    handler: async (request) => {
      const {workspaceId, slug} = request.params;
      requireWorkspaceAccess({request, workspaceId});
      assertWorkspaceProviderConfigurationEnabled(workspaceProviderPolicy);

      const discoveryParams = await resolveCustomModelProviderDiscoveryParams(
        {
          workspaceId,
          providerId: slug,
          body: request.body ?? {},
        },
        {secrets},
      );

      return await discoverCustomModelProviderModels(discoveryParams);
    },
  });
}
