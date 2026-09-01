import {MAX_WORKFLOW_FILE_BYTES} from '@shipfox/api-definitions-dto';
import {z} from 'zod';
import {jobStatusReasonSchema, jobStatusSchema} from './job.js';
import {jobModeSchema, listenerStatusSchema} from './job-listening.js';
import {
  jobExecutionStatusSchema,
  WORKFLOW_RUN_ATTEMPT_MAX,
  workflowRunAttemptDtoSchema,
  workflowRunDevSourceSchema,
  workflowRunOriginSchema,
  workflowRunTriggerReferenceSchema,
} from './workflow-run.js';

/** Maximum number of graph nodes returned by the complete overview variant. */
export const WORKFLOW_RUN_OVERVIEW_COMPLETE_JOB_LIMIT = 100;

/** Maximum number of dependency edges returned by the complete overview variant. */
export const WORKFLOW_RUN_OVERVIEW_COMPLETE_EDGE_LIMIT = 200;

/** Maximum uncompressed serialized size used to choose the large-workflow variant. */
export const WORKFLOW_RUN_OVERVIEW_RESPONSE_BYTE_LIMIT = 200 * 1024;

/** Fixed page size for the large-workflow job list. */
export const WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT = 100;

/** Execution counts are exact up to this value and capped above it. */
export const WORKFLOW_RUN_EXECUTION_COUNT_LIMIT = 100;

/** Source snapshots use the existing workflow-definition file byte limit. */
export const WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES = MAX_WORKFLOW_FILE_BYTES;

/** Persisted execution status-reason messages are bounded at the read boundary. */
export const JOB_EXECUTION_STATUS_REASON_MESSAGE_MAX_LENGTH = 2048;

export const boundedExecutionCountSchema = z.union([
  z.number().int().nonnegative().max(WORKFLOW_RUN_EXECUTION_COUNT_LIMIT),
  z.literal('100+'),
]);

export type BoundedExecutionCountDto = z.infer<typeof boundedExecutionCountSchema>;

export const jobExecutionDisplayStatusSchema = jobExecutionStatusSchema;

export type JobExecutionDisplayStatusDto = z.infer<typeof jobExecutionDisplayStatusSchema>;

export const jobExecutionSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  sequence: z.number().int().positive(),
  name: z.string(),
  status: jobExecutionStatusSchema,
  display_status: jobExecutionDisplayStatusSchema,
  status_reason: jobStatusReasonSchema.nullable(),
  status_reason_message: z.string().max(JOB_EXECUTION_STATUS_REASON_MESSAGE_MAX_LENGTH).nullable(),
  queued_at: z.string().datetime().nullable(),
  started_at: z.string().datetime().nullable(),
  finished_at: z.string().datetime().nullable(),
  timed_out_at: z.string().datetime().nullable(),
  updated_at: z.string().datetime(),
});

export type JobExecutionSummaryDto = z.infer<typeof jobExecutionSummaryDtoSchema>;

export const jobExecutionStatusCountsDtoSchema = z.object({
  pending: boundedExecutionCountSchema,
  running: boundedExecutionCountSchema,
  succeeded: boundedExecutionCountSchema,
  failed: boundedExecutionCountSchema,
  cancelled: boundedExecutionCountSchema,
});

export type JobExecutionStatusCountsDto = z.infer<typeof jobExecutionStatusCountsDtoSchema>;

export const workflowRunJobOverviewDtoSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string().nullable(),
  position: z.number().int().nonnegative(),
  dependencies: z.array(z.string()),
  status: jobStatusSchema,
  status_reason: jobStatusReasonSchema.nullable(),
  mode: jobModeSchema,
  listener_status: listenerStatusSchema,
  carried_over: z.boolean(),
  execution_count: boundedExecutionCountSchema,
  execution_status_counts: jobExecutionStatusCountsDtoSchema,
  default_execution: jobExecutionSummaryDtoSchema.nullable(),
});

export type WorkflowRunJobOverviewDto = z.infer<typeof workflowRunJobOverviewDtoSchema>;

export const workflowRunJobListSummaryDtoSchema = workflowRunJobOverviewDtoSchema.omit({
  dependencies: true,
});

export type WorkflowRunJobListSummaryDto = z.infer<typeof workflowRunJobListSummaryDtoSchema>;

export const workflowRunOverviewHeaderDtoSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  definition_id: z.string().uuid(),
  number: z.number().int().positive(),
  name: z.string(),
  workflow_name: z.string(),
  origin: workflowRunOriginSchema,
  dev_source: workflowRunDevSourceSchema.nullable(),
  trigger_provider: z.string().nullable(),
  trigger_source: z.string(),
  trigger_event: z.string(),
  trigger_reference: workflowRunTriggerReferenceSchema.nullable(),
  created_at: z.string().datetime(),
});

export type WorkflowRunOverviewHeaderDto = z.infer<typeof workflowRunOverviewHeaderDtoSchema>;

export const workflowRunOverviewCompleteJobsDtoSchema = z.object({
  kind: z.literal('complete'),
  total: z.number().int().nonnegative(),
  items: z.array(workflowRunJobOverviewDtoSchema).max(WORKFLOW_RUN_OVERVIEW_COMPLETE_JOB_LIMIT),
});

export type WorkflowRunOverviewCompleteJobsDto = z.infer<
  typeof workflowRunOverviewCompleteJobsDtoSchema
>;

export const workflowRunOverviewLargeJobsDtoSchema = z.object({
  kind: z.literal('large'),
  total: z.number().int().nonnegative(),
  status_counts: z.array(
    z.object({
      status: jobStatusSchema,
      count: z.number().int().positive(),
    }),
  ),
  first_page: z.object({
    items: z
      .array(workflowRunJobListSummaryDtoSchema)
      .max(WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT),
    next_cursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
  }),
});

export type WorkflowRunOverviewLargeJobsDto = z.infer<typeof workflowRunOverviewLargeJobsDtoSchema>;

export const workflowRunOverviewResponseSchema = z.object({
  run: workflowRunOverviewHeaderDtoSchema,
  attempt: workflowRunAttemptDtoSchema,
  has_started_job_execution: z.boolean(),
  jobs: z.discriminatedUnion('kind', [
    workflowRunOverviewCompleteJobsDtoSchema,
    workflowRunOverviewLargeJobsDtoSchema,
  ]),
});

export type WorkflowRunOverviewResponseDto = z.infer<typeof workflowRunOverviewResponseSchema>;

export const workflowRunOverviewQuerySchema = z.object({
  attempt: z.coerce.number().int().positive().max(WORKFLOW_RUN_ATTEMPT_MAX),
});

export type WorkflowRunOverviewQueryDto = z.infer<typeof workflowRunOverviewQuerySchema>;

export const workflowRunOverviewJobsQuerySchema = z.object({
  attempt: z.coerce.number().int().positive().max(WORKFLOW_RUN_ATTEMPT_MAX),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT)
    .default(WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT),
  cursor: z.string().optional(),
});

export type WorkflowRunOverviewJobsQueryDto = z.infer<typeof workflowRunOverviewJobsQuerySchema>;

export const workflowRunOverviewJobsResponseSchema = z.object({
  items: z
    .array(workflowRunJobListSummaryDtoSchema)
    .max(WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT),
  next_cursor: z.string().nullable(),
  total: z.number().int().nonnegative().optional(),
});

export type WorkflowRunOverviewJobsResponseDto = z.infer<
  typeof workflowRunOverviewJobsResponseSchema
>;
