import {agentThinkingSchema, harnessSchema} from '@shipfox/workflow-document';
import {z} from 'zod';
import {customModelProviderRuntimeConfigSchema} from './custom-model-provider.js';
import {isReservedModelProviderId, modelProviderRefSchema} from './model-provider-id.js';

const credentialKeySchema = z.string().min(1);
const credentialValueSchema = z.string().min(1);

export const claudeRuntimeConfigSchema = z.object({
  base_url: z.string().url().max(2048),
  auth_token: credentialValueSchema,
});

export type ClaudeRuntimeConfigDto = z.infer<typeof claudeRuntimeConfigSchema>;

/**
 * Lease-scoped runtime credentials. The credential values are secrets and must
 * never be written to logs, traces, client state, or generic catalog surfaces.
 */
export const agentRuntimeCredentialsResponseSchema = z
  .object({
    harness: harnessSchema,
    provider_id: modelProviderRefSchema,
    model: z.string().min(1),
    thinking: agentThinkingSchema,
    credentials: z.record(credentialKeySchema, credentialValueSchema),
    custom_provider: customModelProviderRuntimeConfigSchema.optional(),
    claude: claudeRuntimeConfigSchema.optional(),
  })
  .superRefine((response, ctx) => {
    if (response.claude !== undefined && isReservedModelProviderId(response.provider_id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['claude'],
        message: 'The per-step claude runtime block is only issued for managed model providers.',
      });
      return;
    }

    if (
      isReservedModelProviderId(response.provider_id) ||
      response.custom_provider !== undefined ||
      response.claude !== undefined
    ) {
      return;
    }

    ctx.addIssue({
      code: 'custom',
      path: ['custom_provider'],
      message: 'Custom model provider runtime config is required for custom model provider refs.',
    });
  });

export type AgentRuntimeCredentialsResponseDto = z.infer<
  typeof agentRuntimeCredentialsResponseSchema
>;
export type {CustomModelProviderRuntimeConfigDto} from './custom-model-provider.js';
export {customModelProviderRuntimeConfigSchema};
