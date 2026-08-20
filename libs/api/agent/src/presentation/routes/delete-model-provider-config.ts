import {modelProviderRefSchema} from '@shipfox/api-agent-dto';
import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  assertWorkspaceProviderConfigurationEnabled,
  deleteModelProviderConfig,
} from '#core/index.js';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import type {WorkspaceProviderPolicyOptions} from '#core/workspace-provider-policy.js';
import {translateModelProviderRouteError} from './errors.js';

export function createDeleteModelProviderConfigRoute(
  secrets: AgentSecretsClient,
  workspaceProviderPolicy: WorkspaceProviderPolicyOptions = {workspaceProviders: 'enabled'},
) {
  return defineRoute({
    method: 'DELETE',
    path: '/model-providers/:providerId',
    description: 'Delete a model provider configuration for a workspace',
    schema: {
      params: z.object({
        workspaceId: z.string().uuid(),
        providerId: modelProviderRefSchema,
      }),
      response: {
        204: z.void(),
      },
    },
    errorHandler: translateModelProviderRouteError,
    handler: async (request, reply) => {
      const {workspaceId, providerId} = request.params;
      requireWorkspaceAccess({request, workspaceId});
      assertWorkspaceProviderConfigurationEnabled(workspaceProviderPolicy);

      const deleted = await deleteModelProviderConfig({workspaceId, providerId}, {secrets});
      if (!deleted) {
        throw new ClientError('Model provider configuration not found', 'not-found', {status: 404});
      }

      reply.code(204);
    },
  });
}
