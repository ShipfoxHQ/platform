import {z} from 'zod';
import {stepSourceLocationSchema} from './step.js';
import {workflowRunAncestrySchema} from './workflow-run-ancestry.js';

const nestedIdentityDefinitions = [
  {key: 'step_attempt_id', depth: 'step_attempt'},
  {key: 'step_id', depth: 'step'},
  {key: 'job_execution_id', depth: 'execution'},
  {key: 'job_id', depth: 'job'},
] as const;

export type WorkflowRunSelectionDepth = (typeof nestedIdentityDefinitions)[number]['depth'];

export function getWorkflowRunSelectionDepth(
  query: Pick<WorkflowRunSelectionQueryDto, (typeof nestedIdentityDefinitions)[number]['key']>,
): WorkflowRunSelectionDepth {
  return nestedIdentityDefinitions.find(({key}) => query[key] !== undefined)?.depth ?? 'job';
}

export const workflowRunSelectionQuerySchema = z
  .object({
    attempt: z.coerce.number().int().positive().optional(),
    job_id: z.string().uuid().optional(),
    job_execution_id: z.string().uuid().optional(),
    step_id: z.string().uuid().optional(),
    step_attempt_id: z.string().uuid().optional(),
  })
  .superRefine((value, context) => {
    if (nestedIdentityDefinitions.every(({key}) => value[key] === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one nested identity is required',
      });
    }
  });

export type WorkflowRunSelectionQueryDto = z.infer<typeof workflowRunSelectionQuerySchema>;

export const workflowRunSelectionSchema = workflowRunAncestrySchema.extend({
  source_location: stepSourceLocationSchema.nullable(),
});

export const workflowRunSelectionResponseSchema = workflowRunSelectionSchema;

export type WorkflowRunSelectionDto = z.infer<typeof workflowRunSelectionSchema>;
export type WorkflowRunSelectionResponseDto = z.infer<typeof workflowRunSelectionResponseSchema>;
