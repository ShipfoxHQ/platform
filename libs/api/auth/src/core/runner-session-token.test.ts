import {JOB_LEASE_TOKEN_AUDIENCE, RUNNER_SESSION_TOKEN_AUDIENCE} from '@shipfox/api-auth-dto';
import {runnerSessionTokenKey} from '@shipfox/node-auth-root-key';
import {signHs256} from '@shipfox/node-jwt';
import {generateKeyPair, SignJWT} from 'jose';
import {issueJobLeaseToken, verifyJobLeaseToken} from './job-lease-token.js';
import {issueRunnerSessionToken, verifyRunnerSessionToken} from './runner-session-token.js';

const SECRET = runnerSessionTokenKey();

function claims() {
  return {
    runnerSessionId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    scope: 'workspace' as const,
    labels: ['linux', 'x64'],
    maxClaims: null,
    lifecycleCapabilities: ['local_execution_fence_v1'],
  };
}

describe('runner-session-token', () => {
  test('issues a token that verifies round-trip', async () => {
    const input = claims();

    const token = await issueRunnerSessionToken(input);
    const verified = await verifyRunnerSessionToken(token);

    expect(verified).not.toBeNull();
    expect(verified?.runnerSessionId).toBe(input.runnerSessionId);
    expect(verified?.workspaceId).toBe(input.workspaceId);
    expect(verified?.scope).toBe(input.scope);
    expect(verified?.labels).toEqual(input.labels);
    expect(verified?.maxClaims).toBeNull();
    expect(verified?.lifecycleCapabilities).toEqual(input.lifecycleCapabilities);
    expect(verified?.aud).toBe(RUNNER_SESSION_TOKEN_AUDIENCE);
    expect(verified?.iat).toBeTypeOf('number');
    expect(verified?.exp).toBeGreaterThan(verified?.iat ?? 0);
  });

  test('rejects a job lease token', async () => {
    const leaseToken = await issueJobLeaseToken({
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      jobId: crypto.randomUUID(),
      jobExecutionId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      runnerSessionId: crypto.randomUUID(),
    });

    const verified = await verifyRunnerSessionToken(leaseToken);

    expect(verified).toBeNull();
  });

  test('job lease verifier rejects a runner session token', async () => {
    const sessionToken = await issueRunnerSessionToken(claims());

    const verified = await verifyJobLeaseToken(sessionToken);

    expect(verified).toBeNull();
  });

  test('returns null for a token signed with a different secret', async () => {
    const token = await signHs256({
      payload: claims(),
      secret: 'a-different-secret',
      expiresIn: '1h',
      audience: RUNNER_SESSION_TOKEN_AUDIENCE,
    });

    const verified = await verifyRunnerSessionToken(token);

    expect(verified).toBeNull();
  });

  test('returns null for an expired token', async () => {
    const token = await signHs256({
      payload: claims(),
      secret: SECRET,
      expiresIn: '-1s',
      audience: RUNNER_SESSION_TOKEN_AUDIENCE,
    });

    const verified = await verifyRunnerSessionToken(token);

    expect(verified).toBeNull();
  });

  test('returns null for an RS256-signed token', async () => {
    const {privateKey} = await generateKeyPair('RS256');
    const token = await new SignJWT(claims())
      .setProtectedHeader({alg: 'RS256'})
      .setIssuedAt()
      .setExpirationTime('1h')
      .setAudience(RUNNER_SESSION_TOKEN_AUDIENCE)
      .sign(privateKey);

    const verified = await verifyRunnerSessionToken(token);

    expect(verified).toBeNull();
  });

  test('returns null for a token with the wrong audience', async () => {
    const token = await signHs256({
      payload: claims(),
      secret: SECRET,
      expiresIn: '1h',
      audience: JOB_LEASE_TOKEN_AUDIENCE,
    });

    const verified = await verifyRunnerSessionToken(token);

    expect(verified).toBeNull();
  });

  test('returns null for a token whose claims fail the schema', async () => {
    const token = await signHs256({
      payload: {...claims(), labels: []},
      secret: SECRET,
      expiresIn: '1h',
      audience: RUNNER_SESSION_TOKEN_AUDIENCE,
    });

    const verified = await verifyRunnerSessionToken(token);

    expect(verified).toBeNull();
  });
});
