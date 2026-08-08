import {z} from 'zod';
import {evaluationTraceSchema} from './evaluation-trace.js';
import {
  jobListeningSchema,
  jobModeSchema,
  listenerStatusSchema,
  resolutionReasonSchema,
} from './job-listening.js';

export const jobStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
]);

export const jobStatusReasonSchema = z.enum([
  'dependency_not_completed',
  'condition_false',
  'default_gate_rejected',
  'condition_rejected',
  'condition_errored',
  'user_cancelled',
  'run_cancelled',
  'timed_out',
  'runner_lost',
  'output_too_large',
  'step_failed',
  'unknown',
]);

export const jobDtoSchema = z.object({
  id: z.string().uuid(),
  run_attempt_id: z.string().uuid(),
  key: z.string(),
  name: z.string().nullable(),
  mode: jobModeSchema,
  status: jobStatusSchema,
  status_reason: jobStatusReasonSchema.nullable(),
  carried_over: z.boolean(),
  success: z.string().nullable(),
  runner: z.array(z.string()).nullable(),
  evaluation_trace: evaluationTraceSchema.nullable(),
  listening: jobListeningSchema.nullable(),
  listener_status: listenerStatusSchema,
  resolution_reason: resolutionReasonSchema.nullable(),
  outputs: z.record(z.string(), z.unknown()).nullable(),
  dependencies: z.array(z.string()),
  position: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type JobDto = z.infer<typeof jobDtoSchema>;
export type JobStatusDto = z.infer<typeof jobStatusSchema>;
export type JobStatusReasonDto = z.infer<typeof jobStatusReasonSchema>;
