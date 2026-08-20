import {
  modelProviderConfigDtoSchema,
  supportedModelProviderIdSchema,
  updateModelProviderConfigBodySchema,
} from '@shipfox/api-agent-dto';
import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  assertWorkspaceProviderConfigurationEnabled,
  testAndSaveModelProviderConfig,
} from '#core/index.js';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import type {WorkspaceProviderPolicyOptions} from '#core/workspace-provider-policy.js';
import {toModelProviderConfigDto} from '#presentation/dto/index.js';
import {translateModelProviderRouteError} from './errors.js';

export function createUpsertModelProviderConfigRoute(
  secrets: AgentSecretsClient,
  workspaceProviderPolicy: WorkspaceProviderPolicyOptions = {workspaceProviders: 'enabled'},
) {
  return defineRoute({
    method: 'PUT',
    path: '/model-providers/:providerId',
    description: 'Test and save a model provider configuration for a workspace',
    schema: {
      params: z.object({
        workspaceId: z.string().uuid(),
        providerId: supportedModelProviderIdSchema,
      }),
      body: updateModelProviderConfigBodySchema,
      response: {
        200: modelProviderConfigDtoSchema,
      },
    },
    errorHandler: translateModelProviderRouteError,
    handler: async (request, reply) => {
      const {workspaceId, providerId} = request.params;
      const abortController = new AbortController();
      let responseFinished = false;
      reply.raw.on('finish', () => {
        responseFinished = true;
      });
      reply.raw.on('close', () => {
        if (!responseFinished) abortController.abort();
      });

      const membership = requireWorkspaceAccess({request, workspaceId});
      assertWorkspaceProviderConfigurationEnabled(workspaceProviderPolicy);

      const config = await testAndSaveModelProviderConfig(
        {
          workspaceId,
          providerId,
          ...('default_model' in request.body ? {defaultModel: request.body.default_model} : {}),
          credentials: request.body.credentials,
          editedBy: membership.userId,
          setAsDefault: request.body.set_as_default,
          signal: abortController.signal,
        },
        {secrets},
      );

      return toModelProviderConfigDto(config);
    },
  });
}
