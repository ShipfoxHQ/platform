import {annotationDtoSchema} from '@shipfox/annotations-dto';
import {z} from 'zod';
import {type CursorPageDto, cursorPageSchema} from './cursor-page.js';
import {evaluationTraceSchema} from './evaluation-trace.js';
import {jobStatusReasonSchema} from './job.js';
import {WORKFLOW_RUN_ATTEMPT_MAX, WORKFLOW_RUN_JOB_POSITION_MAX} from './workflow-run.js';

/** Maximum number of enriched annotations returned by one request. */
export const WORKFLOW_RUN_ANNOTATIONS_PAGE_LIMIT = 100;

/** Maximum number of no-execution job explanations returned by one request. */
export const WORKFLOW_RUN_JOB_EXPLANATIONS_PAGE_LIMIT = 100;

const workflowRunAnnotationPageQueryFields = {
  attempt: z.coerce.number().int().positive().max(WORKFLOW_RUN_ATTEMPT_MAX),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(WORKFLOW_RUN_ANNOTATIONS_PAGE_LIMIT)
    .default(WORKFLOW_RUN_ANNOTATIONS_PAGE_LIMIT),
  cursor: z.string().optional(),
};

export const workflowRunAnnotationsQuerySchema = z.object(workflowRunAnnotationPageQueryFields);

export type WorkflowRunAnnotationsQueryDto = z.infer<typeof workflowRunAnnotationsQuerySchema>;

export const workflowRunJobExplanationsQuerySchema = z.object({
  ...workflowRunAnnotationPageQueryFields,
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(WORKFLOW_RUN_JOB_EXPLANATIONS_PAGE_LIMIT)
    .default(WORKFLOW_RUN_JOB_EXPLANATIONS_PAGE_LIMIT),
});

export type WorkflowRunJobExplanationsQueryDto = z.infer<
  typeof workflowRunJobExplanationsQuerySchema
>;

export const workflowRunAnnotationOriginSchema = z.object({
  job_id: z.string().uuid(),
  job_label: z.string(),
  job_position: z.number().int().nonnegative().max(WORKFLOW_RUN_JOB_POSITION_MAX),
  job_execution_id: z.string().uuid(),
  execution_sequence: z.number().int().positive(),
  execution_label: z.string().nullable(),
  step_id: z.string().uuid(),
  step_label: z.string(),
  // An annotation can be projected before a step is dispatched. The step and its
  // requested attempt remain canonical, but there is no step-attempt row to link.
  step_attempt_id: z.string().uuid().nullable(),
  step_attempt: z.number().int().positive(),
});

export type WorkflowRunAnnotationOriginDto = z.infer<typeof workflowRunAnnotationOriginSchema>;

export const workflowRunAnnotationItemSchema = z.object({
  annotation: annotationDtoSchema,
  origin: workflowRunAnnotationOriginSchema,
});

export type WorkflowRunAnnotationItemDto = z.infer<typeof workflowRunAnnotationItemSchema>;

export const workflowRunAnnotationsResponseSchema = cursorPageSchema(
  workflowRunAnnotationItemSchema,
).extend({
  items: z.array(workflowRunAnnotationItemSchema).max(WORKFLOW_RUN_ANNOTATIONS_PAGE_LIMIT),
});

export type WorkflowRunAnnotationsResponseDto = CursorPageDto<WorkflowRunAnnotationItemDto>;

export const workflowRunJobExplanationStatusSchema = z.enum(['failed', 'skipped']);

export const workflowRunJobExplanationDtoSchema = z.object({
  job_id: z.string().uuid(),
  job_label: z.string(),
  job_position: z.number().int().nonnegative().max(WORKFLOW_RUN_JOB_POSITION_MAX),
  status: workflowRunJobExplanationStatusSchema,
  status_reason: jobStatusReasonSchema.nullable(),
  evaluation_trace: evaluationTraceSchema.nullable(),
});

export type WorkflowRunJobExplanationDto = z.infer<typeof workflowRunJobExplanationDtoSchema>;

export const workflowRunJobExplanationsResponseSchema = cursorPageSchema(
  workflowRunJobExplanationDtoSchema,
).extend({
  items: z.array(workflowRunJobExplanationDtoSchema).max(WORKFLOW_RUN_JOB_EXPLANATIONS_PAGE_LIMIT),
});

export type WorkflowRunJobExplanationsResponseDto = CursorPageDto<WorkflowRunJobExplanationDto>;
