import {harnessSchema, materializedAgentIntegrationSchema} from '@shipfox/api-agent-dto';
import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';

const idSchema = z.string().uuid();
const triggerPayloadSchema = z.union([
  z.object({
    provider: z.literal('manual').optional(),
    source: z.literal('manual'),
    event: z.literal('fire'),
    subscriptionId: idSchema,
    userId: idSchema,
  }),
  z.object({
    provider: z.literal('cron').optional(),
    source: z.literal('cron'),
    event: z.literal('tick'),
    scheduleId: idSchema,
  }),
  z.object({
    provider: z.string(),
    source: z.string(),
    event: z.string(),
    deliveryId: z.string(),
    data: z.unknown(),
  }),
]);

const interpolationFieldSchema = z.enum([
  'run',
  'env',
  'agent.prompt',
  'agent.model',
  'agent.provider',
  'job.runner',
  'job.outputs',
  'job.name',
  'job.execution_name',
  'workflow.run_name',
  'step.name',
  'step.working_directory',
  'step.feedback',
]);

/**
 * Producer-owned Workflows commands used by synchronous callers. Commands carry
 * stable identities whenever a retry could create a duplicate run.
 */
export const workflowsInterModuleContract = defineInterModuleContract({
  module: 'workflows',
  methods: {
    startRunFromTrigger: {
      input: z.object({
        workspaceId: idSchema,
        projectId: idSchema,
        definitionId: idSchema,
        triggerPayload: triggerPayloadSchema,
        inputs: z.record(z.string(), z.unknown()).optional(),
        idempotencyKey: z.string().min(1),
      }),
      output: z.object({id: idSchema, name: z.string()}),
      errors: {
        'workspace-not-found': z.object({workspaceId: idSchema}),
        'workspace-suspended': z.object({workspaceId: idSchema}),
        'workspace-deleted': z.object({workspaceId: idSchema}),
        'definition-not-found': z.object({definitionId: idSchema}),
        'project-mismatch': z.object({}),
        'agent-config-unresolvable': z.object({definitionId: idSchema}),
        'agent-integration-materialization-failed': z.object({}),
        'interpolation-unresolvable': z.object({
          definitionId: idSchema,
          field: interpolationFieldSchema,
          source: z.string(),
          envKey: z.string().optional(),
        }),
        'invalid-job-runner-labels': z.object({labels: z.array(z.string())}),
      },
    },
    deliverEventToJobListener: {
      input: z.object({
        jobId: idSchema,
        disposition: z.enum(['fire', 'resolve']),
        eventRef: z.string().min(1),
        deliveryId: z.string().min(1),
        source: z.string().min(1),
        event: z.string().min(1),
        provider: z.string().min(1),
        payload: z.unknown(),
        receivedAt: z.string().datetime(),
      }),
      output: z.object({buffered: z.boolean(), skipped: z.boolean()}),
      errors: {
        'workspace-not-found': z.object({workspaceId: idSchema}),
        'workspace-suspended': z.object({workspaceId: idSchema}),
        'workspace-deleted': z.object({workspaceId: idSchema}),
      },
    },
    getStepLogContext: {
      input: z.object({stepId: idSchema}),
      output: z.object({harness: harnessSchema}),
    },
    getLeasedAgentToolContext: {
      input: z.object({
        jobId: idSchema,
        jobExecutionId: idSchema,
        runnerSessionId: idSchema,
        stepId: idSchema,
        attempt: z.number().int().positive(),
      }),
      output: z.object({
        workspaceId: idSchema,
        integrations: z.array(materializedAgentIntegrationSchema),
      }),
      errors: {
        'lease-not-active': z.object({}),
        'step-not-found': z.object({}),
        'job-not-found': z.object({}),
        'step-attempt-mismatch': z.object({}),
        'step-not-running': z.object({}),
        'leased-step-not-agent': z.object({}),
        'agent-step-config-invalid': z.object({}),
      },
    },
  },
});

export type WorkflowsModuleClient = InterModuleClient<typeof workflowsInterModuleContract>;
