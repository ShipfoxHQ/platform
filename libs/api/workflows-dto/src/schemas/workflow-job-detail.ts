import {z} from 'zod';
import {type CursorPageDto, cursorPageSchema} from './cursor-page.js';
import {stepErrorDtoSchema, stepSourceLocationSchema, stepStatusReasonSchema} from './step.js';
import {WORKFLOW_RUN_ATTEMPT_MAX} from './workflow-run.js';
import {
  boundedExecutionCountSchema,
  jobExecutionSummaryDtoSchema,
  workflowRunJobOverviewDtoSchema,
} from './workflow-run-overview.js';

/** Default and maximum page sizes for selected-job execution history. */
export const WORKFLOW_JOB_EXECUTION_PAGE_LIMIT = 25;
export const WORKFLOW_JOB_EXECUTION_PAGE_MAX = 100;

/** Maximum number of steps returned in a selected-job page. */
export const WORKFLOW_JOB_STEP_PAGE_LIMIT = 100;

/** Number of step-attempt summaries embedded in every step page. */
export const WORKFLOW_STEP_ATTEMPT_PREVIEW_LIMIT = 10;

/** Default and maximum page sizes for the step-attempt history endpoint. */
export const WORKFLOW_STEP_ATTEMPT_PAGE_LIMIT = 25;
export const WORKFLOW_STEP_ATTEMPT_PAGE_MAX = 100;

const stepStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
]);

const stepTypeSchema = z.enum(['setup', 'run', 'agent', 'checkout', 'tool']);

const stepGateResultSummarySchema = z
  .discriminatedUnion('kind', [
    z.object({kind: z.literal('none')}),
    z.object({kind: z.literal('not_evaluated')}),
    z.object({
      kind: z.literal('passed'),
      passed: z.literal(true),
      source: z.string(),
      exit_code: z.number().int().nullable(),
    }),
    z.object({
      kind: z.literal('failed'),
      passed: z.literal(false),
      source: z.string(),
      exit_code: z.number().int().nullable(),
    }),
    z.object({
      kind: z.literal('uncheckable'),
      passed: z.literal(false),
      uncheckable: z.literal(true),
      reason: z.string(),
      exit_code: z.number().int().nullable(),
    }),
    z.object({
      kind: z.literal('evaluation_error'),
      reason: z.string(),
      exit_code: z.number().int().nullable(),
    }),
    // Legacy or future gate payloads remain visible as an explicit unknown without
    // carrying their unbounded data blob in a compact response.
    z.object({kind: z.literal('unknown')}),
  ])
  .nullable();

export type StepGateResultSummaryDto = z.infer<typeof stepGateResultSummarySchema>;

export const stepAttemptSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  attempt: z.number().int().positive().max(WORKFLOW_RUN_ATTEMPT_MAX),
  execution_order: z.number().int().positive(),
  status: stepStatusSchema,
  exit_code: z.number().int().nullable(),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime().nullable(),
  error: stepErrorDtoSchema,
  gate_result: stepGateResultSummarySchema,
});

export type StepAttemptSummaryDto = z.infer<typeof stepAttemptSummaryDtoSchema>;

export const stepSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  key: z.string().nullable(),
  name: z.string(),
  type: stepTypeSchema,
  position: z.number().int().nonnegative(),
  status: stepStatusSchema,
  status_reason: stepStatusReasonSchema.nullable(),
  source_location: stepSourceLocationSchema.nullable(),
  current_attempt: z.number().int().positive(),
  error: stepErrorDtoSchema,
  attempts: cursorPageSchema(stepAttemptSummaryDtoSchema),
});

export type StepSummaryDto = z.infer<typeof stepSummaryDtoSchema>;

export const workflowJobExecutionDetailDtoSchema = jobExecutionSummaryDtoSchema.extend({
  has_context: z.boolean(),
  steps: cursorPageSchema(stepSummaryDtoSchema),
});

export type WorkflowJobExecutionDetailDto = z.infer<typeof workflowJobExecutionDetailDtoSchema>;

export const workflowJobDetailResponseSchema = z.object({
  workflow_run_id: z.string().uuid(),
  workflow_run_attempt: z.number().int().positive().max(WORKFLOW_RUN_ATTEMPT_MAX),
  job: workflowRunJobOverviewDtoSchema,
  selected_execution: workflowJobExecutionDetailDtoSchema.nullable(),
});

export type WorkflowJobDetailDto = z.infer<typeof workflowJobDetailResponseSchema>;

export const workflowJobDetailDtoSchema = workflowJobDetailResponseSchema;

export const workflowJobExecutionSummariesResponseSchema = z.object({
  items: z.array(jobExecutionSummaryDtoSchema).max(WORKFLOW_JOB_EXECUTION_PAGE_MAX),
  next_cursor: z.string().nullable(),
  total: boundedExecutionCountSchema.optional(),
});

export type WorkflowJobExecutionSummariesResponseDto = z.infer<
  typeof workflowJobExecutionSummariesResponseSchema
>;

export const workflowExecutionStepsResponseSchema = z.object({
  items: z.array(stepSummaryDtoSchema).max(WORKFLOW_JOB_STEP_PAGE_LIMIT),
  next_cursor: z.string().nullable(),
  total: z.number().int().nonnegative().optional(),
});

export type WorkflowExecutionStepsResponseDto = z.infer<
  typeof workflowExecutionStepsResponseSchema
>;

export const workflowStepAttemptSummariesResponseSchema = z.object({
  items: z.array(stepAttemptSummaryDtoSchema).max(WORKFLOW_STEP_ATTEMPT_PAGE_MAX),
  next_cursor: z.string().nullable(),
  total: z.number().int().nonnegative().optional(),
});

export type WorkflowStepAttemptSummariesResponseDto = z.infer<
  typeof workflowStepAttemptSummariesResponseSchema
>;

export const workflowJobDetailQuerySchema = z.object({
  execution_id: z.string().uuid().optional(),
});

export type WorkflowJobDetailQueryDto = z.infer<typeof workflowJobDetailQuerySchema>;

export const workflowJobExecutionSummariesQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(WORKFLOW_JOB_EXECUTION_PAGE_MAX)
    .default(WORKFLOW_JOB_EXECUTION_PAGE_LIMIT),
  cursor: z.string().optional(),
});

export type WorkflowJobExecutionSummariesQueryDto = z.infer<
  typeof workflowJobExecutionSummariesQuerySchema
>;

export const workflowExecutionStepsQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(WORKFLOW_JOB_STEP_PAGE_LIMIT)
    .default(WORKFLOW_JOB_STEP_PAGE_LIMIT),
  cursor: z.string().optional(),
});

export type WorkflowExecutionStepsQueryDto = z.infer<typeof workflowExecutionStepsQuerySchema>;

export const workflowStepAttemptSummariesQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(WORKFLOW_STEP_ATTEMPT_PAGE_MAX)
    .default(WORKFLOW_STEP_ATTEMPT_PAGE_LIMIT),
  cursor: z.string().optional(),
});

export type WorkflowStepAttemptSummariesQueryDto = z.infer<
  typeof workflowStepAttemptSummariesQuerySchema
>;

export type StepSummaryPageDto = CursorPageDto<StepSummaryDto>;
export type StepAttemptSummaryPageDto = CursorPageDto<StepAttemptSummaryDto>;

// Aliases keep the selected-job contract discoverable beside the existing run-named DTOs.
export const workflowRunJobDetailResponseSchema = workflowJobDetailResponseSchema;
export type WorkflowRunJobDetailResponseDto = WorkflowJobDetailDto;
export type WorkflowRunSelectedJobDetailDto = WorkflowJobDetailDto;
