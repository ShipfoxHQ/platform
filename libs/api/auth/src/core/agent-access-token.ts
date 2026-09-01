import {
  AGENT_ACCESS_TOKEN_AUDIENCE,
  type AgentAccessTokenClaims,
  agentAccessTokenClaimsSchema,
} from '@shipfox/api-auth-dto';
import {userAccessTokenKey} from '@shipfox/node-auth-root-key';
import {signHs256, verifyHs256} from '@shipfox/node-jwt';

/** OAuth access tokens are deliberately shorter-lived than refresh tokens. */
export const AGENT_ACCESS_TOKEN_EXPIRES_IN = '15m';
export const AGENT_ACCESS_TOKEN_EXPIRES_IN_SECONDS = 15 * 60;

// `aud`, `iat`, and `exp` are set by the codec; callers provide the grant
// identity and the workspace-scoped capability.
export type IssueAgentAccessTokenParams = Omit<AgentAccessTokenClaims, 'aud' | 'iat' | 'exp'>;

export async function issueAgentAccessToken(claims: IssueAgentAccessTokenParams): Promise<string> {
  return await signHs256({
    payload: {
      workspaceId: claims.workspaceId,
      grantId: claims.grantId,
      clientId: claims.clientId,
      scopes: claims.scopes,
    },
    secret: userAccessTokenKey(),
    expiresIn: AGENT_ACCESS_TOKEN_EXPIRES_IN,
    subject: claims.sub,
    audience: AGENT_ACCESS_TOKEN_AUDIENCE,
  });
}

/** Returns claims on success, or null for any invalid or expired token. */
export async function verifyAgentAccessToken(
  token: string,
): Promise<AgentAccessTokenClaims | null> {
  try {
    return await verifyHs256({
      token,
      secret: userAccessTokenKey(),
      schema: agentAccessTokenClaimsSchema,
      audience: AGENT_ACCESS_TOKEN_AUDIENCE,
    });
  } catch {
    return null;
  }
}
