import {z} from 'zod';
import {stepSourceLocationSchema} from './step.js';
import {workflowRunAncestrySchema} from './workflow-run-ancestry.js';

const nestedIdentityKeys = ['job_id', 'job_execution_id', 'step_id', 'step_attempt_id'] as const;

export const workflowRunSelectionQuerySchema = z
  .object({
    attempt: z.coerce.number().int().positive().optional(),
    job_id: z.string().uuid().optional(),
    job_execution_id: z.string().uuid().optional(),
    step_id: z.string().uuid().optional(),
    step_attempt_id: z.string().uuid().optional(),
  })
  .superRefine((value, context) => {
    if (nestedIdentityKeys.every((key) => value[key] === undefined)) {
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
