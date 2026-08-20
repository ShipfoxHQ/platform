import {
  setDefaultModelProviderBodySchema,
  setDefaultModelProviderResponseSchema,
} from '@shipfox/api-agent-dto';
import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  assertWorkspaceProviderConfigurationEnabled,
  UnsupportedModelProviderError,
} from '#core/index.js';
import {getModelProviderEntry} from '#core/model-provider-policy.js';
import type {WorkspaceProviderPolicyOptions} from '#core/workspace-provider-policy.js';
import {getModelProviderConfig, setDefaultModelProvider} from '#db/index.js';
import {translateModelProviderRouteError} from './errors.js';

export function createSetDefaultModelProviderRoute(
  workspaceProviderPolicy: WorkspaceProviderPolicyOptions = {workspaceProviders: 'enabled'},
) {
  return defineRoute({
    method: 'PUT',
    path: '/default-model-provider',
    description: 'Set the default model provider for a workspace',
    schema: {
      params: z.object({workspaceId: z.string().uuid()}),
      body: setDefaultModelProviderBodySchema,
      response: {
        200: setDefaultModelProviderResponseSchema,
      },
    },
    errorHandler: translateModelProviderRouteError,
    handler: async (request) => {
      const {workspaceId} = request.params;
      requireWorkspaceAccess({request, workspaceId});
      assertWorkspaceProviderConfigurationEnabled(workspaceProviderPolicy);

      const existingConfig = await getModelProviderConfig({
        workspaceId,
        providerId: request.body.provider_id,
      });
      if (existingConfig?.kind !== 'custom') {
        const entry = getModelProviderEntry(request.body.provider_id);
        if (entry === undefined || entry.support_status !== 'supported') {
          throw new UnsupportedModelProviderError(request.body.provider_id);
        }
      }

      const settings = await setDefaultModelProvider({
        workspaceId,
        providerId: request.body.provider_id,
      });

      return {default_provider_id: settings.defaultProviderId};
    },
  });
}

export const setDefaultModelProviderRoute = createSetDefaultModelProviderRoute();
