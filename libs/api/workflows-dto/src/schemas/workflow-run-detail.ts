import {z} from 'zod';
import {evaluationTraceSchema} from './evaluation-trace.js';
import {jobDtoSchema, jobStatusSchema} from './job.js';
import {workflowExecutionEventSchema} from './job-listening.js';
import {stepAttemptDetailDtoSchema, stepAttemptDtoSchema, stepDtoSchema} from './step.js';
import {
  jobExecutionStatusSchema,
  validateWorkflowRunOrigin,
  workflowRunAttemptDtoSchema,
  workflowRunDtoFields,
} from './workflow-run.js';

export const workflowRunDiagnosticReadLimitsSchema = z
  .object({
    jobs: z.number().int().min(1).max(10),
    executions: z.number().int().min(1).max(1),
    steps: z.number().int().min(1).max(20),
    attempts: z.number().int().min(1).max(1),
  })
  .strict();

export type WorkflowRunDiagnosticReadLimits = z.infer<typeof workflowRunDiagnosticReadLimitsSchema>;

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
  attempts_total_count: z.number().int().nonnegative().optional(),
});

export type WorkflowRunStepDetailDto = z.infer<typeof workflowRunStepDetailDtoSchema>;

export const stepAttemptDetailResponseSchema = z.object({
  step_id: z.string().uuid(),
  attempt: stepAttemptDetailDtoSchema.shape.attempt,
  authored_config: z.record(z.string(), z.unknown()).nullable(),
  config: stepAttemptDetailDtoSchema.shape.config,
  // Optional for mixed-version readers; the server derives this from the typed step projection.
  session: stepDtoSchema.shape.session,
  evaluation_trace: stepAttemptDetailDtoSchema.shape.evaluation_trace,
});

export type StepAttemptDetailResponseDto = z.infer<typeof stepAttemptDetailResponseSchema>;

export const workflowRunJobExecutionDetailDtoSchema = jobExecutionDtoSchema.extend({
  steps: z.array(workflowRunStepDetailDtoSchema),
  steps_total_count: z.number().int().nonnegative().optional(),
});

export type WorkflowRunJobExecutionDetailDto = z.infer<
  typeof workflowRunJobExecutionDetailDtoSchema
>;

export const workflowRunJobDetailDtoSchema = jobDtoSchema.extend({
  job_executions: z.array(workflowRunJobExecutionDetailDtoSchema),
  job_executions_total_count: z.number().int().nonnegative().optional(),
});

export type WorkflowRunJobDetailDto = z.infer<typeof workflowRunJobDetailDtoSchema>;

// The run detail read model returned by `GET /workflows/runs/:id`: a run plus its
// jobs, each job's steps, and each step's attempt history.
export const workflowRunDetailResponseSchema = z
  .object({
    ...workflowRunDtoFields,
    run_attempt: workflowRunAttemptDtoSchema,
    jobs: z.array(workflowRunJobDetailDtoSchema),
    jobs_total_count: z.number().int().nonnegative().optional(),
    job_status_counts: z
      .array(z.object({status: jobStatusSchema, count: z.number().int().nonnegative()}))
      .optional(),
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
