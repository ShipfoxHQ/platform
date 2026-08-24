import {harnessSchema, materializedAgentIntegrationSchema} from '@shipfox/api-agent-dto';
import {workflowModelSnapshotSchema} from '@shipfox/api-definitions-dto';
import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';

const idSchema = z.string().uuid();
const workflowRunTriggerReferenceSchema = z.object({
  project: z.object({id: idSchema}).nullable(),
  repository: z.string().nullable(),
  ref: z.string().nullable(),
  commit: z.string().nullable(),
  actor: z.string().nullable(),
});
const triggerPayloadSchema = z.union([
  z.object({
    provider: z.literal('manual').optional(),
    source: z.literal('manual'),
    event: z.literal('fire'),
    // A dev trigger has no subscription row, so the id is optional here. Manual
    // fires from a subscription keep sending it.
    subscriptionId: idSchema.optional(),
    userId: idSchema,
  }),
  z.object({
    provider: z.literal('cron').optional(),
    source: z.literal('cron'),
    event: z.literal('tick'),
    // A dev trigger has no schedule row, so the id is optional here. Cron fires
    // from a schedule keep sending it.
    scheduleId: idSchema.optional(),
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
  'agent.thinking',
  'job.runner',
  'job.outputs',
  'job.execution_name',
  'workflow.run_name',
  'step.name',
  'step.working_directory',
  'step.feedback',
  'checkout.project',
  'checkout.connection',
  'checkout.repository',
  'checkout.ref',
  'checkout.path',
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
        triggerConnectionId: idSchema.optional(),
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
    startDevRun: {
      input: z.object({
        workspaceId: idSchema,
        projectId: idSchema,
        // Workflow lineage id, becomes the run's definition_id.
        workflowId: idSchema,
        model: workflowModelSnapshotSchema,
        sourceSnapshot: z.object({content: z.string(), format: z.literal('yaml')}),
        devSource: z.object({
          ref: z.string().min(1).max(256),
          commit: z.string().min(1).max(64),
          configPath: z.string().min(1).max(1024),
          initiatedByUserId: idSchema,
          replayOfEventId: idSchema.optional(),
        }),
        triggerConnectionId: idSchema.optional(),
        triggerPayload: triggerPayloadSchema,
        inputs: z.record(z.string(), z.unknown()).optional(),
      }),
      output: z.object({id: idSchema, name: z.string()}),
      errors: {
        'workspace-not-found': z.object({workspaceId: idSchema}),
        'workspace-suspended': z.object({workspaceId: idSchema}),
        'workspace-deleted': z.object({workspaceId: idSchema}),
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
    resolveWorkflowRunTriggerReference: {
      input: z.object({
        workspaceId: idSchema,
        triggerConnectionId: idSchema,
        triggerPayload: triggerPayloadSchema,
      }),
      output: workflowRunTriggerReferenceSchema.nullable(),
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
        triggerConnectionId: idSchema.optional(),
        triggerReference: workflowRunTriggerReferenceSchema.nullable().optional(),
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
