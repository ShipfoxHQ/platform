import {z} from 'zod';
import {jobStatusSchema} from './job.js';
import {jobModeSchema, listenerStatusSchema} from './job-listening.js';

export const workflowRunStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export type WorkflowRunStatusDto = z.infer<typeof workflowRunStatusSchema>;

export const jobExecutionStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const workflowRunRerunModeSchema = z.enum(['all', 'failed']);

export type WorkflowRunRerunModeDto = z.infer<typeof workflowRunRerunModeSchema>;

export const rerunWorkflowRunBodySchema = z.object({
  mode: workflowRunRerunModeSchema,
});

export type RerunWorkflowRunBodyDto = z.infer<typeof rerunWorkflowRunBodySchema>;

const isoDateTimeSchema = z.string().datetime();
const runListQueryBaseSchema = z.object({
  project_id: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  status: workflowRunStatusSchema.optional(),
  definition_id: z.string().uuid().optional(),
  trigger_source: z.string().optional(),
  created_from: isoDateTimeSchema.optional(),
  created_to: isoDateTimeSchema.optional(),
});

function validateDateWindow(
  value: {created_from?: string | undefined; created_to?: string | undefined},
  ctx: z.RefinementCtx,
) {
  if (!value.created_from || !value.created_to) return;
  const from = new Date(value.created_from);
  const to = new Date(value.created_to);
  if (from > to) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'created_from must be before or equal to created_to',
      path: ['created_from'],
    });
    return;
  }

  const maxWindowMs = 365 * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > maxWindowMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'created date window must be 365 days or less',
      path: ['created_to'],
    });
  }
}

export const workflowRunListQuerySchema = runListQueryBaseSchema.superRefine(validateDateWindow);

export type WorkflowRunListQueryDto = z.infer<typeof workflowRunListQuerySchema>;

export const workflowRunAggregatesQuerySchema = runListQueryBaseSchema
  .omit({limit: true, cursor: true})
  .superRefine(validateDateWindow);

export type WorkflowRunAggregatesQueryDto = z.infer<typeof workflowRunAggregatesQuerySchema>;

export const workflowSourceSnapshotSchema = z.object({
  content: z.string(),
  format: z.literal('yaml'),
});

export type WorkflowSourceSnapshotDto = z.infer<typeof workflowSourceSnapshotSchema>;

// Provider-neutral trigger facts captured at run creation. Every field is nullable because
// only source-control triggers resolve one at all, and a given payload may name a ref
// without naming an actor.
export const workflowRunTriggerReferenceSchema = z.object({
  repository: z.string().nullable(),
  ref: z.string().nullable(),
  commit: z.string().nullable(),
  actor: z.string().nullable(),
});

export type WorkflowRunTriggerReferenceDto = z.infer<typeof workflowRunTriggerReferenceSchema>;

export const workflowRunDtoSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  definition_id: z.string().uuid(),
  number: z.number().int().positive(),
  name: z.string(),
  workflow_name: z.string(),
  status: workflowRunStatusSchema,
  current_attempt: z.number().int().positive(),
  latest_attempt: z.number().int().positive(),
  trigger_provider: z.string().nullable(),
  trigger_source: z.string(),
  trigger_event: z.string(),
  trigger_payload: z.record(z.string(), z.unknown()),
  trigger_reference: workflowRunTriggerReferenceSchema.nullable(),
  inputs: z.record(z.string(), z.unknown()).nullable(),
  source_snapshot: workflowSourceSnapshotSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
});

export type WorkflowRunDto = z.infer<typeof workflowRunDtoSchema>;

export const workflowRunAttemptDtoSchema = z.object({
  id: z.string().uuid(),
  workflow_run_id: z.string().uuid(),
  attempt: z.number().int().positive(),
  status: workflowRunStatusSchema,
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  rerun_mode: workflowRunRerunModeSchema.nullable(),
});

export type WorkflowRunAttemptDto = z.infer<typeof workflowRunAttemptDtoSchema>;

export const workflowRunResponseSchema = workflowRunDtoSchema;

export type WorkflowRunResponseDto = z.infer<typeof workflowRunResponseSchema>;

export const workflowRunAttemptsResponseSchema = z.object({
  attempts: z.array(workflowRunAttemptDtoSchema),
});

export type WorkflowRunAttemptsResponseDto = z.infer<typeof workflowRunAttemptsResponseSchema>;

// The run list renders a status glyph per job so a failing run can be read without being
// opened. Runtime state comes from the selected execution rather than the job verdict, while
// mode and listener status let the client apply the same display rule as run detail.
export const workflowRunJobSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string().nullable(),
  status: jobStatusSchema,
  mode: jobModeSchema,
  listener_status: listenerStatusSchema,
  execution_status: jobExecutionStatusSchema.nullable(),
  position: z.number().int().nonnegative(),
});

export type WorkflowRunJobSummaryDto = z.infer<typeof workflowRunJobSummaryDtoSchema>;

/**
 * How many jobs a run list row carries in graph order.
 *
 * A workflow has no job limit, and the list is polled while runs are active, so the row
 * cannot carry every job of every run on the page. This bound is the API's, deliberately set
 * above what any current surface draws: a client is free to show fewer without a server
 * change, and `job_status_counts` still describes the jobs beyond it.
 */
export const WORKFLOW_RUN_JOB_PREVIEW_LIMIT = 16;

/** One display status and how many of the run's jobs render it, counted over all of them. */
export const workflowRunJobStatusCountDtoSchema = z.object({
  status: jobStatusSchema.or(z.literal('listening')),
  count: z.number().int().positive(),
});

export type WorkflowRunJobStatusCountDto = z.infer<typeof workflowRunJobStatusCountDtoSchema>;

export const workflowRunListItemSchema = workflowRunResponseSchema.extend({
  /** Up to `WORKFLOW_RUN_JOB_PREVIEW_LIMIT` jobs in graph order, not the whole set. */
  jobs: z.array(workflowRunJobSummaryDtoSchema).max(WORKFLOW_RUN_JOB_PREVIEW_LIMIT),
  /** Counted over every job of the attempt, including those past the preview. */
  job_status_counts: z.array(workflowRunJobStatusCountDtoSchema),
});

export type WorkflowRunListItemDto = z.infer<typeof workflowRunListItemSchema>;

export const workflowRunListResponseSchema = z.object({
  runs: z.array(workflowRunListItemSchema),
  next_cursor: z.string().nullable(),
  filtered_total_count: z.number().int().nonnegative().nullable(),
});

export type WorkflowRunListResponseDto = z.infer<typeof workflowRunListResponseSchema>;

const aggregateBucketSchema = z.object({
  value: z.string(),
  count: z.number().int().nonnegative(),
});

export const workflowRunAggregatesResponseSchema = z.object({
  status: z.array(
    z.object({value: workflowRunStatusSchema, count: z.number().int().nonnegative()}),
  ),
  trigger_source: z.array(aggregateBucketSchema),
  workflow: z.array(aggregateBucketSchema),
});

export type WorkflowRunAggregatesResponseDto = z.infer<typeof workflowRunAggregatesResponseSchema>;
