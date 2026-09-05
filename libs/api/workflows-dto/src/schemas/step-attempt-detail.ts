import {z} from 'zod';
import {stepAttemptDetailDtoSchema, stepAttemptDtoSchema, stepDtoSchema} from './step.js';
import {workflowRunAttemptDtoSchema} from './workflow-run.js';
import {
  oversizedFieldDtoSchema,
  WORKFLOW_STEP_ATTEMPT_INVOCATION_READ_MAX,
} from './workflow-run-diagnostics.js';

export const stepAttemptDetailResponseSchema = z.object({
  // These ancestry and attempt-result fields were added after the original
  // lazy detail contract. Keep them optional while old and new servers roll
  // out together.
  workflow_run_id: z.string().uuid().optional(),
  workflow_run_attempt: workflowRunAttemptDtoSchema.shape.attempt.optional(),
  job_id: z.string().uuid().optional(),
  job_execution_id: z.string().uuid().optional(),
  step_id: z.string().uuid(),
  step_attempt_id: z.string().uuid().optional(),
  attempt: stepAttemptDetailDtoSchema.shape.attempt,
  authored_config: z.record(z.string(), z.unknown()).nullable(),
  config: stepAttemptDetailDtoSchema.shape.config,
  // Optional for mixed-version readers; the server derives this from the typed step projection.
  session: stepDtoSchema.shape.session,
  evaluation_trace: stepAttemptDetailDtoSchema.shape.evaluation_trace,
  output: stepAttemptDtoSchema.shape.output.optional(),
  outputs: stepAttemptDtoSchema.shape.outputs.optional(),
  response: stepAttemptDtoSchema.shape.response.optional(),
  error: stepAttemptDtoSchema.shape.error.optional(),
  gate_result: stepAttemptDtoSchema.shape.gate_result.optional(),
  invocations: stepAttemptDtoSchema.shape.invocations
    .unwrap()
    .max(WORKFLOW_STEP_ATTEMPT_INVOCATION_READ_MAX)
    .optional(),
  restart_feedback: stepAttemptDtoSchema.shape.restart_feedback.optional(),
  oversized_fields: z.array(oversizedFieldDtoSchema).optional(),
});

export type StepAttemptDetailResponseDto = z.infer<typeof stepAttemptDetailResponseSchema>;
