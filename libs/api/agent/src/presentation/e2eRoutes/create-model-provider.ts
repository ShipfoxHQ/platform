import {DEFAULT_AGENT_THINKING} from '@shipfox/api-agent-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {agentSystemNamespace} from '#core/credential-fingerprints.js';
import {listHarnessProviderModels} from '#core/harness/registry.js';
import {
  assertWorkspaceProviderConfigurationEnabled,
  type WorkspaceProviderPolicyOptions,
} from '#core/index.js';
import {getModelProviderEntry} from '#core/model-provider-policy.js';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import {upsertModelProviderConfig} from '#db/index.js';
import {translateModelProviderRouteError} from '#presentation/routes/errors.js';

const createE2eModelProviderBodySchema = z.object({
  workspace_id: z.string().uuid(),
  provider_id: z.literal('anthropic'),
  api_key: z.string().min(1),
  default_model: z.string().min(1).optional(),
  set_as_default: z.boolean().optional(),
});

const createE2eModelProviderResponseSchema = z.object({
  provider_id: z.literal('anthropic'),
});

export function createE2eModelProviderRoute(
  secrets: AgentSecretsClient,
  workspaceProviderPolicy: WorkspaceProviderPolicyOptions = {workspaceProviders: 'enabled'},
) {
  return defineRoute({
    method: 'POST',
    path: '/model-provider',
    description: 'Create an Anthropic model provider config for E2E tests.',
    schema: {
      body: createE2eModelProviderBodySchema,
      response: {201: createE2eModelProviderResponseSchema},
    },
    errorHandler: translateModelProviderRouteError,
    handler: async (request, reply) => {
      assertWorkspaceProviderConfigurationEnabled(workspaceProviderPolicy);
      const entry = getModelProviderEntry(request.body.provider_id);
      if (entry === undefined || entry.default_model === null) {
        throw new ClientError('Unsupported E2E model provider', 'unsupported-model-provider', {
          status: 400,
        });
      }
      const defaultModel = request.body.default_model ?? entry.default_model;
      const supportedModels = listHarnessProviderModels('claude', request.body.provider_id);
      if (!supportedModels.some((model) => model.id === defaultModel)) {
        throw new ClientError('Unsupported Anthropic default model', 'unsupported-model', {
          status: 400,
          details: {default_model: defaultModel},
        });
      }

      await secrets.setSecrets({
        workspaceId: request.body.workspace_id,
        namespace: agentSystemNamespace(request.body.provider_id),
        values: {API_KEY: request.body.api_key},
      });
      await upsertModelProviderConfig({
        workspaceId: request.body.workspace_id,
        providerId: request.body.provider_id,
        defaultModel,
        defaultThinking: DEFAULT_AGENT_THINKING,
        setAsDefault: request.body.set_as_default,
      });

      reply.code(201);
      return {provider_id: request.body.provider_id};
    },
  });
}
