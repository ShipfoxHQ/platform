import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {
  agentRuntimeCredentialsResponseSchema,
  agentThinkingSchema,
  harnessSchema,
  modelProviderRefSchema,
} from '#schemas/index.js';

const agentValidationCatalogSchema = z.object({
  version: z.literal(1),
  providers: z.array(
    z.object({
      id: z.string().min(1),
      support_status: z.enum(['supported', 'unsupported']),
    }),
  ),
  harnesses: z.array(
    z.object({
      id: harnessSchema,
      supported_provider_ids: z.array(z.string().min(1)),
      model_ids_by_provider: z.record(z.string().min(1), z.array(z.string().min(1))).optional(),
      thinking_levels: z.array(agentThinkingSchema),
      effective_tools: z.array(z.string().min(1)),
    }),
  ),
});

export type AgentValidationCatalog = z.infer<typeof agentValidationCatalogSchema>;

const agentConfigInputSchema = z.object({
  harness: harnessSchema.optional(),
  provider: modelProviderRefSchema.optional(),
  model: z.string().optional(),
  thinking: agentThinkingSchema.optional(),
});

const resolvedAgentConfigSchema = z.object({
  harness: harnessSchema,
  provider: modelProviderRefSchema,
  model: z.string(),
  thinking: agentThinkingSchema,
});

export const agentInterModuleContract = defineInterModuleContract({
  module: 'agent',
  methods: {
    getValidationCatalog: {
      input: z.object({}),
      output: agentValidationCatalogSchema,
      errors: {},
    },
    resolveAgentConfig: {
      input: z.object({workspaceId: z.string().uuid().nullable(), config: agentConfigInputSchema}),
      output: resolvedAgentConfigSchema,
      errors: {'agent-config-invalid': z.object({})},
    },
    resolveRuntimeCredentials: {
      input: z.object({
        workspaceId: z.string().uuid(),
        harness: harnessSchema,
        provider: modelProviderRefSchema,
        model: z.string(),
        thinking: agentThinkingSchema,
      }),
      output: agentRuntimeCredentialsResponseSchema,
      errors: {
        'model-provider-not-configured': z.object({}),
        'model-provider-credentials-invalid': z.object({}),
      },
    },
  },
});

export type AgentInterModuleClient = InterModuleClient<typeof agentInterModuleContract>;
