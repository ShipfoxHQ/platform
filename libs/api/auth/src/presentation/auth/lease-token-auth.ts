import {AUTH_LEASED_JOB, setLeasedJobContext} from '@shipfox/api-auth-context';
import type {AuthMethod} from '@shipfox/node-fastify';
import {verifyJobLeaseToken} from '#core/job-lease-token.js';
import {createBearerTokenAuthMethod} from './bearer-token-auth.js';

/**
 * Trust boundary: the signed token is the sole authority. `claims.jobId` scopes
 * every runner request to exactly one job. `workflowRunId`/`workflowRunAttemptId`/`workspaceId`
 * are carried for consumers but are NOT verified against the database here.
 *
 * Revocation tradeoff: `runnerSessionId` is carried in the claims but is not checked
 * against runner-session storage, so a lease minted before its registration token is
 * revoked stays usable until it expires (`AUTH_JOB_LEASE_TOKEN_EXPIRES_IN`, 90m).
 * Accepted deliberately for a short-lived, job-scoped capability token; tightening
 * this would mean a per-request DB lookup on the hot status-reporting path. See the
 * "Security model" section in the package README for the full rationale.
 */
export function createLeaseTokenAuthMethod(): AuthMethod {
  return createBearerTokenAuthMethod({
    name: AUTH_LEASED_JOB,
    verifyToken: verifyJobLeaseToken,
    invalidTokenError: {message: 'Invalid or expired job lease token', code: 'unauthorized'},
    setContext: setLeasedJobContext,
  });
}
