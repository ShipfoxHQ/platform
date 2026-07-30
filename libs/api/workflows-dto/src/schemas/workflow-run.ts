import {z} from 'zod';

export const workflowRunStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export type WorkflowRunStatusDto = z.infer<typeof workflowRunStatusSchema>;

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

export const workflowRunListResponseSchema = z.object({
  runs: z.array(workflowRunResponseSchema),
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
