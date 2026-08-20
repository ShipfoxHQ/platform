import {
  modelProviderConfigResponseSchema,
  modelProviderRefSchema,
  updateModelProviderDefaultModelBodySchema,
} from '@shipfox/api-agent-dto';
import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  assertWorkspaceProviderConfigurationEnabled,
  updateModelProviderConfigDefaultModel,
} from '#core/index.js';
import type {WorkspaceProviderPolicyOptions} from '#core/workspace-provider-policy.js';
import {toModelProviderConfigResponseDto} from '#presentation/dto/index.js';
import {translateModelProviderRouteError} from './errors.js';

export function createUpdateModelProviderDefaultModelRoute(
  workspaceProviderPolicy: WorkspaceProviderPolicyOptions = {workspaceProviders: 'enabled'},
) {
  return defineRoute({
    method: 'PUT',
    path: '/model-providers/:providerId/default-model',
    description: 'Update the default model for an existing model provider configuration',
    schema: {
      params: z.object({
        workspaceId: z.string().uuid(),
        providerId: modelProviderRefSchema,
      }),
      body: updateModelProviderDefaultModelBodySchema,
      response: {
        200: modelProviderConfigResponseSchema,
      },
    },
    errorHandler: translateModelProviderRouteError,
    handler: async (request) => {
      const {workspaceId, providerId} = request.params;
      requireWorkspaceAccess({request, workspaceId});
      assertWorkspaceProviderConfigurationEnabled(workspaceProviderPolicy);

      const config = await updateModelProviderConfigDefaultModel({
        workspaceId,
        providerId,
        defaultModel: request.body.default_model,
      });

      return toModelProviderConfigResponseDto(config);
    },
  });
}

export const updateModelProviderDefaultModelRoute = createUpdateModelProviderDefaultModelRoute();
