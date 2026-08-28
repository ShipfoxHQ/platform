import {z} from 'zod';

/**
 * Audience claim binding a token to runner-session data-plane auth. Distinct from
 * job lease tokens (separate secret) so session tokens and per-job capabilities
 * stay non-interchangeable.
 */
export const RUNNER_SESSION_TOKEN_AUDIENCE = 'runner-session';

export const runnerSessionTokenClaimsSchema = z.object({
  runnerSessionId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  scope: z.literal('workspace'),
  labels: z.array(z.string()).min(1),
  maxClaims: z.number().int().positive().nullable(),
  lifecycleCapabilities: z.array(z.string()).max(8).optional(),
  aud: z.literal(RUNNER_SESSION_TOKEN_AUDIENCE),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type RunnerSessionTokenClaims = z.infer<typeof runnerSessionTokenClaimsSchema>;
