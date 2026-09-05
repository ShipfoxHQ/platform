import {
  agentSessionDescriptorSchema,
  harnessSchema,
  materializedAgentIntegrationSchema,
} from '@shipfox/api-agent-dto';
import {workflowModelSnapshotSchema} from '@shipfox/api-definitions-dto';
import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {stepAttemptDetailResponseSchema} from './schemas/step-attempt-detail.js';
import {
  WORKFLOW_EXECUTION_TRIGGER_EVENT_PAGE_LIMIT,
  WORKFLOW_EXECUTION_TRIGGER_EVENT_PAGE_MAX,
  workflowExecutionTriggerEventDetailSchema,
  workflowExecutionTriggerEventSummarySchema,
  workflowExecutionTriggerEventsResponseSchema,
} from './schemas/workflow-execution-events.js';
import {workflowExecutionPayloadFieldSchema} from './schemas/workflow-execution-payload.js';
import {
  WORKFLOW_JOB_EXECUTION_PAGE_LIMIT,
  WORKFLOW_JOB_EXECUTION_PAGE_MAX,
  WORKFLOW_JOB_STEP_PAGE_LIMIT,
  WORKFLOW_STEP_ATTEMPT_PAGE_LIMIT,
  WORKFLOW_STEP_ATTEMPT_PAGE_MAX,
  workflowExecutionStepsResponseSchema,
  workflowJobDetailResponseSchema,
  workflowJobExecutionSummariesResponseSchema,
  workflowStepAttemptSummariesResponseSchema,
} from './schemas/workflow-job-detail.js';
import {
  validateDateWindow,
  WORKFLOW_RUN_ATTEMPT_MAX,
  WORKFLOW_RUN_ATTEMPT_PAGE_LIMIT,
  workflowRunAttemptDtoSchema,
  workflowRunListItemSchema,
  workflowRunOriginSchema,
  workflowRunStatusSchema,
} from './schemas/workflow-run.js';
import {
  WORKFLOW_RUN_ANNOTATIONS_PAGE_LIMIT,
  WORKFLOW_RUN_JOB_EXPLANATIONS_PAGE_LIMIT,
  workflowRunAnnotationItemSchema,
  workflowRunJobExplanationDtoSchema,
} from './schemas/workflow-run-annotations.js';
import {
  WORKFLOW_RUN_FAILED_STEP_ATTEMPT_LIMIT,
  workflowDiagnosticFieldSchema,
  workflowJobExecutionContextResponseSchema,
  workflowRunSourceResponseSchema,
} from './schemas/workflow-run-diagnostics.js';
import {
  WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT,
  workflowRunJobListSummaryDtoSchema,
  workflowRunOverviewResponseSchema,
} from './schemas/workflow-run-overview.js';

const idSchema = z.string().uuid();
const admissionDeniedDetailsSchema = z.object({
  workspaceId: idSchema,
  reason: z.string(),
  requiredAction: z
    .object({
      reason: z.string(),
      message: z.string(),
      url: z.string(),
    })
    .optional(),
});
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
  'agent.session',
  'job.runner',
  'job.outputs',
  'job.execution_name',
  'workflow.run_name',
  'step.name',
  'step.working_directory',
  'step.feedback',
  'tool.with',
  'tool.outputs',
  'checkout.project',
  'checkout.connection',
  'checkout.repository',
  'checkout.ref',
  'checkout.path',
]);

const attemptSchema = z.number().int().min(1).max(WORKFLOW_RUN_ATTEMPT_MAX);
const workflowRunAttemptsInterModulePageSchema = z.object({
  items: z.array(workflowRunAttemptDtoSchema).max(100),
  nextCursor: z.string().nullable(),
});
const workflowRunJobsInterModulePageSchema = z.object({
  workflow_run_attempt: attemptSchema,
  items: z.array(workflowRunJobListSummaryDtoSchema).max(100),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative().optional(),
});
const workflowJobExecutionsInterModulePageSchema = z.object({
  items: workflowJobExecutionSummariesResponseSchema.shape.items,
  nextCursor: z.string().nullable(),
  total: workflowJobExecutionSummariesResponseSchema.shape.total,
});
const workflowExecutionStepsInterModulePageSchema = z.object({
  items: workflowExecutionStepsResponseSchema.shape.items,
  nextCursor: z.string().nullable(),
  total: workflowExecutionStepsResponseSchema.shape.total,
});
const workflowStepAttemptsInterModulePageSchema = z.object({
  items: workflowStepAttemptSummariesResponseSchema.shape.items,
  nextCursor: z.string().nullable(),
  total: workflowStepAttemptSummariesResponseSchema.shape.total,
});
const workflowExecutionTriggerEventsInterModulePageSchema = z.object({
  items: workflowExecutionTriggerEventSummarySchema
    .extend({cursor: z.string().min(1)})
    .array()
    .max(WORKFLOW_EXECUTION_TRIGGER_EVENT_PAGE_MAX),
  nextCursor: z.string().nullable(),
  total: workflowExecutionTriggerEventsResponseSchema.shape.total,
});
const workflowRunAnnotationsInterModulePageSchema = z.object({
  workflow_run_attempt: attemptSchema,
  items: z.array(workflowRunAnnotationItemSchema).max(WORKFLOW_RUN_ANNOTATIONS_PAGE_LIMIT),
  nextCursor: z.string().nullable(),
});
const workflowRunJobExplanationsInterModulePageSchema = z.object({
  workflow_run_attempt: attemptSchema,
  items: z.array(workflowRunJobExplanationDtoSchema).max(WORKFLOW_RUN_JOB_EXPLANATIONS_PAGE_LIMIT),
  nextCursor: z.string().nullable(),
});
const failedStepAttemptCoordinateSchema = z.object({
  workflow_run_id: idSchema,
  workflow_run_attempt: attemptSchema,
  job_id: idSchema,
  job_execution_id: idSchema,
  step_id: idSchema,
  step_attempt_id: idSchema,
  step_attempt: attemptSchema,
});
const workflowRunCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: idSchema,
});
const workflowRunFiltersSchema = z
  .object({
    status: workflowRunStatusSchema.optional(),
    definitionId: idSchema.optional(),
    triggerSource: z.string().optional(),
    origin: workflowRunOriginSchema.optional(),
    createdFrom: z.string().datetime().optional(),
    createdTo: z.string().datetime().optional(),
  })
  .superRefine((value, ctx) =>
    validateDateWindow({from: value.createdFrom, to: value.createdTo}, ctx, {
      from: 'createdFrom',
      to: 'createdTo',
    }),
  );

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
        'admission-denied': admissionDeniedDetailsSchema,
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
        'source-snapshot-too-large': z.object({
          limitBytes: z.number().int().positive(),
          measuredBytes: z.number().int().positive(),
        }),
        'diagnostic-too-large': z.object({
          field: workflowDiagnosticFieldSchema,
          limitBytes: z.number().int().positive(),
          measuredBytes: z.number().int().positive(),
        }),
        'workflow-execution-payload-too-large': z.object({
          field: workflowExecutionPayloadFieldSchema,
          limitBytes: z.number().int().positive(),
          measuredBytes: z.number().int().positive(),
          overshootBytes: z.number().int().positive(),
        }),
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
        'admission-denied': admissionDeniedDetailsSchema,
        'agent-config-unresolvable': z.object({definitionId: idSchema}),
        'agent-integration-materialization-failed': z.object({}),
        'interpolation-unresolvable': z.object({
          definitionId: idSchema,
          field: interpolationFieldSchema,
          source: z.string(),
          envKey: z.string().optional(),
        }),
        'invalid-job-runner-labels': z.object({labels: z.array(z.string())}),
        'source-snapshot-too-large': z.object({
          limitBytes: z.number().int().positive(),
          measuredBytes: z.number().int().positive(),
        }),
        'diagnostic-too-large': z.object({
          field: workflowDiagnosticFieldSchema,
          limitBytes: z.number().int().positive(),
          measuredBytes: z.number().int().positive(),
        }),
        'workflow-execution-payload-too-large': z.object({
          field: workflowExecutionPayloadFieldSchema,
          limitBytes: z.number().int().positive(),
          measuredBytes: z.number().int().positive(),
          overshootBytes: z.number().int().positive(),
        }),
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
      output: z.object({
        buffered: z.boolean(),
        skipped: z.boolean(),
        rejection: z
          .object({
            reason: z.literal('payload-too-large'),
            eventId: z.string().min(1),
            measuredBytes: z.number().int().positive(),
            limitBytes: z.number().int().positive(),
          })
          .optional(),
      }),
      errors: {
        'workspace-not-found': z.object({workspaceId: idSchema}),
        'workspace-suspended': z.object({workspaceId: idSchema}),
        'workspace-deleted': z.object({workspaceId: idSchema}),
        'admission-denied': admissionDeniedDetailsSchema,
      },
    },
    getStepLogContext: {
      input: z.object({stepId: idSchema}),
      output: z.object({harness: harnessSchema}),
    },
    listJobStepAttempts: {
      input: z.object({jobId: idSchema}),
      output: z.object({stepAttemptIds: z.array(idSchema)}),
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
    /**
     * Lease resolution for the agent module's session transcript routes, the
     * `getStepLogContext` equivalent for sessions: verifies the lease and the
     * running agent step, and returns the scope plus the session descriptor
     * recorded on the step attempt at dispatch (`null` for steps without a
     * session). Table, objects, and crypto stay inside the agent module; this
     * method is the workflows-owned half of the resolution.
     *
     * Adding a required method to the published contract is a compile-time
     * break for every implementer or fake, so this expansion is only safe
     * because the implementer surface is internal-only (the presentation in
     * the workflows package and the in-repo test fakes); no out-of-repo
     * implementer exists, which is why the minor bump carries it. Keep any
     * future required additions to the same internal-only assumption.
     */
    getLeasedAgentSessionContext: {
      input: z.object({
        jobId: idSchema,
        jobExecutionId: idSchema,
        runnerSessionId: idSchema,
        stepId: idSchema,
        attempt: z.number().int().positive(),
      }),
      output: z.object({
        workspaceId: idSchema,
        projectId: idSchema,
        workflowRunAttemptId: idSchema,
        /** Step attempt the lease resolved to; the claim/commit discriminator. */
        stepAttemptId: idSchema,
        /** Resolved session descriptor recorded on the step attempt; null when the step has no session. */
        session: agentSessionDescriptorSchema.nullable(),
      }),
      errors: {
        'lease-not-active': z.object({}),
        'step-not-found': z.object({}),
        'job-not-found': z.object({}),
        'step-attempt-mismatch': z.object({}),
        'step-not-running': z.object({}),
        'leased-step-not-agent': z.object({}),
        'step-session-config-invalid': z.object({}),
      },
    },
    listWorkflowRuns: {
      input: z.object({
        workspaceId: idSchema,
        projectId: idSchema,
        limit: z.number().int().min(1).max(100),
        cursor: workflowRunCursorSchema.optional(),
        filters: workflowRunFiltersSchema.optional(),
      }),
      output: z.object({
        runs: z.array(workflowRunListItemSchema),
        nextCursor: workflowRunCursorSchema.nullable(),
        filteredTotalCount: z.number().int().nonnegative().nullable(),
      }),
    },
    /**
     * Bounded read models for synchronous consumers. The producer owns resource
     * ancestry, page limits, cursor encoding, and diagnostic truncation before a
     * result crosses this boundary.
     */
    getWorkflowRunOverview: {
      input: z.object({
        workspaceId: idSchema,
        workflowRunId: idSchema,
        attempt: attemptSchema.optional(),
      }),
      output: workflowRunOverviewResponseSchema.nullable(),
    },
    listWorkflowRunAttempts: {
      input: z.object({
        workspaceId: idSchema,
        workflowRunId: idSchema,
        limit: z.number().int().min(1).max(100).default(WORKFLOW_RUN_ATTEMPT_PAGE_LIMIT),
        cursor: z.string().min(1).optional(),
      }),
      output: workflowRunAttemptsInterModulePageSchema.nullable(),
    },
    listWorkflowRunJobs: {
      input: z.object({
        workspaceId: idSchema,
        workflowRunId: idSchema,
        attempt: attemptSchema.optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT)
          .default(WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT),
        cursor: z.string().min(1).optional(),
      }),
      output: workflowRunJobsInterModulePageSchema.nullable(),
    },
    getWorkflowJobDetail: {
      input: z.object({
        workspaceId: idSchema,
        jobId: idSchema,
        executionId: idSchema.optional(),
      }),
      output: workflowJobDetailResponseSchema.nullable(),
    },
    listWorkflowJobExecutions: {
      input: z.object({
        workspaceId: idSchema,
        jobId: idSchema,
        limit: z
          .number()
          .int()
          .min(1)
          .max(WORKFLOW_JOB_EXECUTION_PAGE_MAX)
          .default(WORKFLOW_JOB_EXECUTION_PAGE_LIMIT),
        cursor: z.string().min(1).optional(),
      }),
      output: workflowJobExecutionsInterModulePageSchema.nullable(),
    },
    listWorkflowExecutionSteps: {
      input: z.object({
        workspaceId: idSchema,
        jobId: idSchema,
        executionId: idSchema,
        limit: z
          .number()
          .int()
          .min(1)
          .max(WORKFLOW_JOB_STEP_PAGE_LIMIT)
          .default(WORKFLOW_JOB_STEP_PAGE_LIMIT),
        cursor: z.string().min(1).optional(),
      }),
      output: workflowExecutionStepsInterModulePageSchema.nullable(),
    },
    listWorkflowStepAttempts: {
      input: z.object({
        workspaceId: idSchema,
        stepId: idSchema,
        limit: z
          .number()
          .int()
          .min(1)
          .max(WORKFLOW_STEP_ATTEMPT_PAGE_MAX)
          .default(WORKFLOW_STEP_ATTEMPT_PAGE_LIMIT),
        cursor: z.string().min(1).optional(),
      }),
      output: workflowStepAttemptsInterModulePageSchema.nullable(),
    },
    getWorkflowRunSource: {
      input: z.object({
        workspaceId: idSchema,
        workflowRunId: idSchema,
        attempt: attemptSchema.optional(),
      }),
      output: workflowRunSourceResponseSchema.nullable(),
    },
    getWorkflowJobExecutionContext: {
      input: z.object({
        workspaceId: idSchema,
        jobId: idSchema,
        executionId: idSchema,
      }),
      output: workflowJobExecutionContextResponseSchema.nullable(),
    },
    listExecutionTriggerEvents: {
      input: z.object({
        workspaceId: idSchema,
        jobId: idSchema,
        executionId: idSchema,
        limit: z
          .number()
          .int()
          .min(1)
          .max(WORKFLOW_EXECUTION_TRIGGER_EVENT_PAGE_MAX)
          .default(WORKFLOW_EXECUTION_TRIGGER_EVENT_PAGE_LIMIT),
        cursor: z.string().min(1).optional(),
      }),
      output: workflowExecutionTriggerEventsInterModulePageSchema.nullable(),
    },
    getExecutionTriggerEvent: {
      input: z.object({
        workspaceId: idSchema,
        jobId: idSchema,
        executionId: idSchema,
        eventRef: z.string().min(1),
      }),
      output: workflowExecutionTriggerEventDetailSchema.nullable(),
    },
    getWorkflowStepAttemptDetail: {
      input: z.object({
        workspaceId: idSchema,
        stepId: idSchema,
        attempt: attemptSchema.optional(),
      }),
      output: stepAttemptDetailResponseSchema.nullable(),
    },
    listWorkflowRunAnnotations: {
      input: z.object({
        workspaceId: idSchema,
        workflowRunId: idSchema,
        attempt: attemptSchema.optional(),
        limit: z.number().int().min(1).max(WORKFLOW_RUN_ANNOTATIONS_PAGE_LIMIT).default(100),
        cursor: z.string().min(1).optional(),
      }),
      output: workflowRunAnnotationsInterModulePageSchema.nullable(),
    },
    listWorkflowRunJobExplanations: {
      input: z.object({
        workspaceId: idSchema,
        workflowRunId: idSchema,
        attempt: attemptSchema.optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(WORKFLOW_RUN_JOB_EXPLANATIONS_PAGE_LIMIT)
          .default(WORKFLOW_RUN_JOB_EXPLANATIONS_PAGE_LIMIT),
        cursor: z.string().min(1).optional(),
      }),
      output: workflowRunJobExplanationsInterModulePageSchema.nullable(),
    },
    listFailedStepAttempts: {
      input: z.object({
        workspaceId: idSchema,
        workflowRunId: idSchema,
        attempt: attemptSchema.optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(WORKFLOW_RUN_FAILED_STEP_ATTEMPT_LIMIT)
          .default(WORKFLOW_RUN_FAILED_STEP_ATTEMPT_LIMIT),
      }),
      output: z
        .object({
          workflow_run_attempt: attemptSchema,
          items: z
            .array(failedStepAttemptCoordinateSchema)
            .max(WORKFLOW_RUN_FAILED_STEP_ATTEMPT_LIMIT),
        })
        .nullable(),
    },
    getStepAttemptDetail: {
      input: z.object({
        workspaceId: idSchema,
        stepId: idSchema,
        attempt: attemptSchema,
      }),
      output: z.object({detail: stepAttemptDetailResponseSchema.nullable()}),
    },
    getLatestRunAttempt: {
      input: z.object({workspaceId: idSchema, workflowRunId: idSchema}),
      output: z.object({attempt: attemptSchema.nullable()}),
    },
    getLatestStepAttempt: {
      input: z.object({workspaceId: idSchema, stepId: idSchema}),
      output: z.object({attempt: attemptSchema.nullable()}),
    },
  },
});

export type WorkflowsModuleClient = InterModuleClient<typeof workflowsInterModuleContract>;
