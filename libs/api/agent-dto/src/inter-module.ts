import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {
  agentRuntimeCredentialsResponseSchema,
  agentSessionDescriptorSchema,
  agentThinkingSchema,
  harnessSchema,
  modelProviderRefSchema,
} from '#schemas/index.js';

const agentValidationCatalogSchema = z.object({
  version: z.literal(1),
  default_harness_id: harnessSchema,
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
  // A resolved template may contain any string; the agent module validates it
  // against the resolved harness and returns the domain error if it is invalid.
  thinking: z.string().optional(),
});

const resolvedAgentConfigSchema = z.object({
  harness: harnessSchema,
  provider: modelProviderRefSchema,
  model: z.string(),
  thinking: agentThinkingSchema,
});

export {type AgentSessionDescriptorDto, agentSessionDescriptorSchema} from '#schemas/index.js';

export const agentInterModuleContract = defineInterModuleContract({
  module: 'agent',
  methods: {
    getValidationCatalog: {
      input: z.object({workspaceId: z.string().uuid().nullable()}),
      output: agentValidationCatalogSchema,
      errors: {},
    },
    resolveAgentConfig: {
      input: z.object({workspaceId: z.string().uuid().nullable(), config: agentConfigInputSchema}),
      output: resolvedAgentConfigSchema,
      errors: {
        'agent-config-invalid': z.object({
          message: z.string().min(1).optional(),
          managed_provider_id: modelProviderRefSchema.optional(),
        }),
      },
    },
    resolveRuntimeCredentials: {
      input: z.object({
        workspaceId: z.string().uuid(),
        runId: z.string().uuid(),
        stepAttemptId: z.string().uuid(),
        harness: harnessSchema,
        provider: modelProviderRefSchema,
        model: z.string(),
        thinking: agentThinkingSchema,
      }),
      output: agentRuntimeCredentialsResponseSchema,
      errors: {
        'model-provider-not-configured': z.object({}),
        'model-provider-credentials-invalid': z.object({}),
        'workspace-providers-disabled': z.object({
          message: z.string().min(1).optional(),
          managed_provider_id: modelProviderRefSchema,
        }),
      },
    },
    claimSession: {
      input: z.object({
        workspaceId: z.string().uuid(),
        projectId: z.string().uuid(),
        workflowRunAttemptId: z.string().uuid(),
        key: z.string().min(1),
        /** Harness resolved for this attempt; a resume claim must match the session's pinned harness. */
        harness: harnessSchema,
        stepAttemptId: z.string().uuid(),
        /** `resume` claims exclusively and may write back; `fork` only reads the current head. */
        mode: z.enum(['resume', 'fork']),
      }),
      output: z.object({
        /** Null when a `fork` targets a session that does not exist yet: the step runs fresh and creates nothing. */
        descriptor: agentSessionDescriptorSchema.nullable(),
        /** Harness the session is pinned to (the resolved harness when no session exists). */
        harness: harnessSchema,
      }),
      errors: {
        'session-key-invalid': z.object({}),
        'session-held': z.object({}),
        'session-harness-mismatch': z.object({}),
        'session-lock-unavailable': z.object({}),
      },
    },
    carryOverSessions: {
      input: z.object({
        fromWorkflowRunAttemptId: z.string().uuid(),
        toWorkflowRunAttemptId: z.string().uuid(),
      }),
      output: z.object({
        sessions: z.array(
          z.object({
            id: z.string().uuid(),
            key: z.string().min(1),
            segment: z.number().int().nonnegative(),
          }),
        ),
      }),
      errors: {
        'carry-over-conflict': z.object({}),
      },
    },
  },
});

export type AgentInterModuleClient = InterModuleClient<typeof agentInterModuleContract>;
