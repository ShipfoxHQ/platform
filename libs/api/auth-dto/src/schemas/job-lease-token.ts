import {z} from 'zod';

/**
 * Audience claim binding a token to the job-lease use case. Distinct from auth
 * tokens (separate secret): this is defense-in-depth so the two token classes stay
 * non-interchangeable even if a verifier is ever misconfigured.
 */
export const JOB_LEASE_TOKEN_AUDIENCE = 'runner-job-lease';

export const jobLeaseTokenClaimsSchema = z.object({
  workflowRunId: z.string().uuid(),
  workflowRunAttempt: z.number().int().positive().optional(),
  workflowRunAttemptId: z.string().uuid(),
  jobId: z.string().uuid(),
  jobExecutionId: z.string().uuid(),
  projectId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  runnerSessionId: z.string().uuid(),
  // Narrows append-log authorization to the step attempt currently dispatched to the runner.
  currentStepId: z.string().uuid().optional(),
  currentStepAttempt: z.number().int().positive().optional(),
  aud: z.literal(JOB_LEASE_TOKEN_AUDIENCE),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type JobLeaseTokenClaims = z.infer<typeof jobLeaseTokenClaimsSchema>;
