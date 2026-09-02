import {z} from 'zod';
import {evaluationTraceSchema} from './evaluation-trace.js';
import {jobDtoSchema} from './job.js';
import {workflowExecutionEventSchema} from './job-listening.js';
import {stepAttemptDetailDtoSchema, stepAttemptDtoSchema, stepDtoSchema} from './step.js';
import {
  jobExecutionStatusSchema,
  validateWorkflowRunOrigin,
  workflowRunAttemptDtoSchema,
  workflowRunDtoFields,
} from './workflow-run.js';
import {
  oversizedFieldDtoSchema,
  WORKFLOW_STEP_ATTEMPT_INVOCATION_READ_MAX,
} from './workflow-run-diagnostics.js';

export const jobExecutionDtoSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  sequence: z.number().int().positive(),
  name: z.string(),
  status: jobExecutionStatusSchema,
  status_reason: z.string().nullable(),
  status_reason_message: z.string().nullable().optional(),
  runner: z.array(z.string()).nullable(),
  trigger_events: z.array(workflowExecutionEventSchema).default([]),
  outputs: z.record(z.string(), z.unknown()).nullable(),
  evaluation_trace: evaluationTraceSchema.nullable(),
  queued_at: z.string().nullable(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  timed_out_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type JobExecutionDto = z.infer<typeof jobExecutionDtoSchema>;

// A step with its attempt history: one entry per dispatched attempt (a restarted
// step has more than one). `current_attempt` on the step points at the latest.
export const workflowRunStepDetailDtoSchema = stepDtoSchema.extend({
  exit_code: z.number().int().nullable(),
  outputs: z.record(z.string(), z.unknown()).nullable(),
  response: z.string().nullable(),
  gate_result: stepAttemptDtoSchema.shape.gate_result,
  attempts: z.array(stepAttemptDtoSchema),
});

export type WorkflowRunStepDetailDto = z.infer<typeof workflowRunStepDetailDtoSchema>;

export const stepAttemptDetailResponseSchema = z.object({
  workflow_run_id: z.string().uuid(),
  workflow_run_attempt: workflowRunAttemptDtoSchema.shape.attempt,
  job_id: z.string().uuid(),
  job_execution_id: z.string().uuid(),
  step_id: z.string().uuid(),
  step_attempt_id: z.string().uuid(),
  attempt: stepAttemptDetailDtoSchema.shape.attempt,
  authored_config: z.record(z.string(), z.unknown()).nullable(),
  config: stepAttemptDetailDtoSchema.shape.config,
  // Optional for mixed-version readers; the server derives this from the typed step projection.
  session: stepDtoSchema.shape.session,
  evaluation_trace: stepAttemptDetailDtoSchema.shape.evaluation_trace,
  output: stepAttemptDtoSchema.shape.output,
  outputs: stepAttemptDtoSchema.shape.outputs,
  response: stepAttemptDtoSchema.shape.response,
  error: stepAttemptDtoSchema.shape.error,
  gate_result: stepAttemptDtoSchema.shape.gate_result,
  invocations: stepAttemptDtoSchema.shape.invocations
    .unwrap()
    .max(WORKFLOW_STEP_ATTEMPT_INVOCATION_READ_MAX),
  restart_feedback: stepAttemptDtoSchema.shape.restart_feedback,
  oversized_fields: z.array(oversizedFieldDtoSchema),
});

export type StepAttemptDetailResponseDto = z.infer<typeof stepAttemptDetailResponseSchema>;

export const workflowRunJobExecutionDetailDtoSchema = jobExecutionDtoSchema.extend({
  steps: z.array(workflowRunStepDetailDtoSchema),
});

export type WorkflowRunJobExecutionDetailDto = z.infer<
  typeof workflowRunJobExecutionDetailDtoSchema
>;

export const workflowRunJobDetailDtoSchema = jobDtoSchema.extend({
  job_executions: z.array(workflowRunJobExecutionDetailDtoSchema),
});

export type WorkflowRunJobDetailDto = z.infer<typeof workflowRunJobDetailDtoSchema>;

// The run detail read model returned by `GET /workflows/runs/:id`: a run plus its
// jobs, each job's steps, and each step's attempt history.
export const workflowRunDetailResponseSchema = z
  .object({
    ...workflowRunDtoFields,
    run_attempt: workflowRunAttemptDtoSchema,
    jobs: z.array(workflowRunJobDetailDtoSchema),
    /**
     * Whether any job execution of this attempt reached its runner. Redundant with the executions
     * below, and deliberately so: the server decides it once for both this response and the run
     * list, which is what keeps the two surfaces from reaching different answers.
     *
     * Defaults to started for the same rollout reason as the list item's copy.
     */
    has_started_job_execution: z.boolean().optional().default(true),
  })
  .superRefine(validateWorkflowRunOrigin);

export type WorkflowRunDetailResponseDto = z.infer<typeof workflowRunDetailResponseSchema>;
