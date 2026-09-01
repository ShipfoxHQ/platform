import {z} from 'zod';

/** Audience binding an OAuth access token to agent-access request auth. */
export const AGENT_ACCESS_TOKEN_AUDIENCE = 'agent-access';

export const agentAccessTokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  workspaceId: z.string().uuid(),
  grantId: z.string().uuid(),
  clientId: z.string().min(1).max(2048),
  scopes: z.array(z.literal('read')).min(1),
  aud: z.literal(AGENT_ACCESS_TOKEN_AUDIENCE),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type AgentAccessTokenClaims = z.infer<typeof agentAccessTokenClaimsSchema>;
