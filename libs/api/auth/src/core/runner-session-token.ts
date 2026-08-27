import {
  RUNNER_SESSION_TOKEN_AUDIENCE,
  type RunnerSessionTokenClaims,
  runnerSessionTokenClaimsSchema,
} from '@shipfox/api-auth-dto';
import {runnerSessionTokenKey} from '@shipfox/node-auth-root-key';
import {signHs256, verifyHs256} from '@shipfox/node-jwt';
import {config} from '#config.js';
import {recordTokenIssued, recordTokenVerified} from '#metrics/index.js';

// `aud`, `iat` and `exp` are set by the codec (jose); callers supply the business ids only.
export type IssueRunnerSessionTokenParams = Omit<RunnerSessionTokenClaims, 'aud' | 'iat' | 'exp'>;

export async function issueRunnerSessionToken(
  claims: IssueRunnerSessionTokenParams,
): Promise<string> {
  const token = await signHs256({
    payload: {
      runnerSessionId: claims.runnerSessionId,
      workspaceId: claims.workspaceId,
      scope: claims.scope,
      labels: claims.labels,
      maxClaims: claims.maxClaims,
      lifecycleCapabilities: claims.lifecycleCapabilities,
    },
    secret: runnerSessionTokenKey(),
    expiresIn: config.AUTH_RUNNER_SESSION_TOKEN_EXPIRES_IN,
    audience: RUNNER_SESSION_TOKEN_AUDIENCE,
  });
  recordTokenIssued('runner_session');
  return token;
}

/** Returns the claims on success, or `null` for any invalid input. Never throws. */
export async function verifyRunnerSessionToken(
  token: string,
): Promise<RunnerSessionTokenClaims | null> {
  try {
    const claims = await verifyHs256({
      token,
      secret: runnerSessionTokenKey(),
      schema: runnerSessionTokenClaimsSchema,
      audience: RUNNER_SESSION_TOKEN_AUDIENCE,
    });
    recordTokenVerified('runner_session', 'ok');
    return claims;
  } catch {
    recordTokenVerified('runner_session', 'rejected');
    return null;
  }
}
