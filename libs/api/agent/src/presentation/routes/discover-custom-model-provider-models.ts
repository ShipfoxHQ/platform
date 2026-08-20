import {
  discoverCustomModelProviderModelsBodySchema,
  discoverCustomModelProviderModelsResponseSchema,
} from '@shipfox/api-agent-dto';
import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  assertWorkspaceProviderConfigurationEnabled,
  discoverCustomModelProviderModels,
} from '#core/index.js';
import type {WorkspaceProviderPolicyOptions} from '#core/workspace-provider-policy.js';
import {translateModelProviderRouteError} from './errors.js';

export function createDiscoverCustomModelProviderModelsRoute(
  workspaceProviderPolicy: WorkspaceProviderPolicyOptions = {workspaceProviders: 'enabled'},
) {
  return defineRoute({
    method: 'POST',
    path: '/custom-model-providers/discover-models',
    description: 'Discover models exposed by a custom model provider endpoint',
    schema: {
      params: z.object({workspaceId: z.string().uuid()}),
      body: discoverCustomModelProviderModelsBodySchema,
      response: {
        200: discoverCustomModelProviderModelsResponseSchema,
      },
    },
    errorHandler: translateModelProviderRouteError,
    handler: async (request) => {
      const {workspaceId} = request.params;
      requireWorkspaceAccess({request, workspaceId});
      assertWorkspaceProviderConfigurationEnabled(workspaceProviderPolicy);

      return await discoverCustomModelProviderModels(request.body);
    },
  });
}

export const discoverCustomModelProviderModelsRoute =
  createDiscoverCustomModelProviderModelsRoute();
