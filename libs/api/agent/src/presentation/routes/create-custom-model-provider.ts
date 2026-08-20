import {
  createCustomModelProviderBodySchema,
  customModelProviderConfigDtoSchema,
} from '@shipfox/api-agent-dto';
import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  assertWorkspaceProviderConfigurationEnabled,
  createCustomModelProviderConfig,
} from '#core/index.js';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import type {WorkspaceProviderPolicyOptions} from '#core/workspace-provider-policy.js';
import {toCustomModelProviderConfigDto} from '#presentation/dto/index.js';
import {translateModelProviderRouteError} from './errors.js';

export function createCustomModelProviderRoute(
  secrets: AgentSecretsClient,
  workspaceProviderPolicy: WorkspaceProviderPolicyOptions = {workspaceProviders: 'enabled'},
) {
  return defineRoute({
    method: 'POST',
    path: '/custom-model-providers',
    description: 'Create a custom model provider configuration for a workspace',
    schema: {
      params: z.object({workspaceId: z.string().uuid()}),
      body: createCustomModelProviderBodySchema,
      response: {
        200: customModelProviderConfigDtoSchema,
      },
    },
    errorHandler: translateModelProviderRouteError,
    handler: async (request, reply) => {
      const {workspaceId} = request.params;
      const abortController = new AbortController();
      let responseFinished = false;
      reply.raw.on('finish', () => {
        responseFinished = true;
      });
      reply.raw.on('close', () => {
        if (!responseFinished) abortController.abort();
      });

      requireWorkspaceAccess({request, workspaceId});
      assertWorkspaceProviderConfigurationEnabled(workspaceProviderPolicy);

      const config = await createCustomModelProviderConfig(
        {
          workspaceId,
          body: request.body,
          signal: abortController.signal,
        },
        {secrets},
      );

      return toCustomModelProviderConfigDto(config);
    },
  });
}
