import {z} from 'zod';

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
  'output_invalid',
]);

export type JobStatusDto = z.infer<typeof jobStatusSchema>;
export type JobStatusReasonDto = z.infer<typeof jobStatusReasonSchema>;
