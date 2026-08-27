import {z} from 'zod';

export const RUNNER_SESSION_EXHAUSTED_CODE = 'runner-session-exhausted' as const;

export const claimedJobResponseSchema = z.object({
  workflow_run_id: z.string().uuid(),
  workflow_run_attempt_id: z.string().uuid(),
  job_id: z.string().uuid(),
  job_execution_id: z.string().uuid(),
  lease_token: z.string().min(1),
  /** Present only when the runner advertised local_execution_fence_v1. */
  isolation_timeout_seconds: z.number().int().positive().max(86400).optional(),
});

export type ClaimedJobResponseDto = z.infer<typeof claimedJobResponseSchema>;
