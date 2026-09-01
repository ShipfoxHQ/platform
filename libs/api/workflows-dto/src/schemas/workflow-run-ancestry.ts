import {z} from 'zod';

export const workflowRunAncestrySchema = z.object({
  workflow_run_id: z.string().uuid(),
  workflow_run_attempt: z.number().int().positive(),
  job_id: z.string().uuid().nullable(),
  job_execution_id: z.string().uuid().nullable(),
  step_id: z.string().uuid().nullable(),
  step_attempt_id: z.string().uuid().nullable(),
  step_attempt: z.number().int().positive().nullable(),
});

export type WorkflowRunAncestryDto = z.infer<typeof workflowRunAncestrySchema>;
