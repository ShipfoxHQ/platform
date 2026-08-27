import {vi} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {runnerActivationTokens} from '#db/schema/runner-activation-tokens.js';
import type {RunnerInstanceInsertDb} from '#db/schema/runner-instances.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
import {
  type RunnerActivationTokenNotIssuedReason,
  runnerActivationTokenNotIssuedCount,
} from '#metrics/instance.js';
import {
  getRunnerSessionTokenClaims,
  manualRegistrationTokenFactory,
  providerRunnerFactory,
  provisionerTokenFactory,
  runnersTestAuthClient,
} from '#test/index.js';
import {EmptyRunnerLabelsError, RunnerLabelsReservedError} from './errors.js';
import {getRunnerAssignment, issueRunnerActivationToken} from './runner-activation.js';
import {registerRunnerSession} from './runner-sessions.js';

const activationTokenNotIssuedCases: Array<{
  reason: RunnerActivationTokenNotIssuedReason;
  update: Partial<RunnerInstanceInsertDb>;
  provisionerId?: string;
}> = [
  {reason: 'runner-not-found', update: {}, provisionerId: crypto.randomUUID()},
  {reason: 'missing-workspace', update: {workspaceId: null}},
  {reason: 'existing-session', update: {runnerSessionId: crypto.randomUUID()}},
  {reason: 'not-running', update: {state: 'starting'}},
];

function activationTokenMetricCalls(spy: {mock: {calls: unknown[][]}}): unknown[][] {
  // The test setup uses a shared NoopMeter counter, so filter calls to this metric before counting.
  return spy.mock.calls.filter(([, attributes]) => {
    if (typeof attributes !== 'object' || attributes === null) return false;
    const reason = (attributes as {reason?: unknown}).reason;
    const surface = (attributes as {surface?: unknown}).surface;
    return (
      ['runner-not-found', 'missing-workspace', 'existing-session', 'not-running'].includes(
        String(reason),
      ) && ['enrollment', 'poll'].includes(String(surface))
    );
  });
}

describe('registerRunnerSession', () => {
  let workspaceId: string;
  let registrationTokenId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const token = await manualRegistrationTokenFactory.create({workspaceId});
    registrationTokenId = token.id;
  });

  it('canonicalizes labels, stores them, and embeds them in the session token', async () => {
    const result = await registerRunnerSession({
      auth: runnersTestAuthClient,
      credential: {kind: 'manual', registrationTokenId, workspaceId},
      labels: [' Linux ', 'x64', 'linux'],
    });

    expect(result.mode).toBe('manual');
    expect(result.maxClaims).toBeNull();
    expect(result.session.labels).toEqual(['linux', 'x64']);
    expect(result.session.registrationTokenKind).toBe('manual');
    expect(result.session.provisionerId).toBeNull();
    expect(result.session.providerRunnerId).toBeNull();
    expect(result.session.maxClaims).toBeNull();
    expect(result.session.claimsUsed).toBe(0);

    const rows = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.id, result.session.id));
    expect(rows[0]?.labels).toEqual(['linux', 'x64']);

    const claims = getRunnerSessionTokenClaims(result.sessionToken);
    expect(claims?.labels).toEqual(['linux', 'x64']);
    expect(claims?.maxClaims).toBeNull();
    expect(claims).not.toHaveProperty('lifecycleCapabilities');
  });

  it('throws EmptyRunnerLabelsError when labels canonicalize to empty', async () => {
    await expect(
      registerRunnerSession({
        auth: runnersTestAuthClient,
        credential: {kind: 'manual', registrationTokenId, workspaceId},
        labels: [' ', '\t'],
      }),
    ).rejects.toBeInstanceOf(EmptyRunnerLabelsError);
  });

  it('names labels removed by the reserved-label policy', () => {
    const error = new RunnerLabelsReservedError(['shipfox-managed']);

    expect(error.message).toBe(
      'All supplied runner labels are reserved for installation-scope provisioners: shipfox-managed',
    );
    expect(error.labels).toEqual(['shipfox-managed']);
  });

  it('rejects an ephemeral session row without a positive max claim cap', async () => {
    await expect(
      db()
        .insert(runnerSessions)
        .values({
          workspaceId,
          scope: 'workspace',
          registrationTokenId: crypto.randomUUID(),
          registrationTokenKind: 'ephemeral',
          provisionerId: crypto.randomUUID(),
          providerRunnerId: `provisioned-runner-${crypto.randomUUID()}`,
          labels: ['linux'],
          maxClaims: null,
          claimsUsed: 0,
        }),
    ).rejects.toThrow();
  });

  it('rejects an ephemeral session row without a provisioned-runner link', async () => {
    await expect(
      db()
        .insert(runnerSessions)
        .values({
          workspaceId,
          scope: 'workspace',
          registrationTokenId: crypto.randomUUID(),
          registrationTokenKind: 'ephemeral',
          labels: ['linux'],
          maxClaims: 1,
          claimsUsed: 0,
        }),
    ).rejects.toThrow();
  });
});

describe('activation runner sessions', () => {
  let workspaceId: string;
  let provisionerId: string;
  let runnerInstanceId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const provisioner = await provisionerTokenFactory.create({workspaceId});
    provisionerId = provisioner.id;
    const runner = await providerRunnerFactory.create({workspaceId, provisionerId});
    runnerInstanceId = runner.id;
  });

  it('replaces an unconsumed activation token when assignment delivery is retried', async () => {
    const firstToken = await issueRunnerActivationToken({
      runnerInstanceId,
      provisionerId,
      ttlSeconds: 60,
      surface: 'poll',
    });
    const replacementToken = await issueRunnerActivationToken({
      runnerInstanceId,
      provisionerId,
      ttlSeconds: 60,
      surface: 'poll',
    });

    const tokens = await db()
      .select()
      .from(runnerActivationTokens)
      .where(eq(runnerActivationTokens.runnerInstanceId, runnerInstanceId));

    expect(firstToken).not.toBeNull();
    expect(replacementToken).not.toBeNull();
    expect(replacementToken).not.toBe(firstToken);
    expect(tokens).toHaveLength(2);
    expect(tokens.filter((token) => token.revokedAt === null)).toHaveLength(1);
    expect(tokens.filter((token) => token.revokedAt !== null)).toHaveLength(1);
  });

  it.each(
    activationTokenNotIssuedCases,
  )('records $reason when direct activation-token issuance is skipped', async ({
    reason,
    update,
    provisionerId: caseProvisionerId,
  }) => {
    const addSpy = vi.spyOn(runnerActivationTokenNotIssuedCount, 'add');

    try {
      if (Object.keys(update).length > 0) {
        await db()
          .update(providerRunners)
          .set(update)
          .where(eq(providerRunners.id, runnerInstanceId));
      }

      const activationToken = await issueRunnerActivationToken({
        runnerInstanceId,
        provisionerId: caseProvisionerId ?? provisionerId,
        ttlSeconds: 60,
        surface: 'poll',
      });

      expect(activationToken).toBeNull();
      expect(activationTokenMetricCalls(addSpy)).toEqual([[1, {reason, surface: 'poll'}]]);
    } finally {
      addSpy.mockRestore();
    }
  });

  it('does not record a metric when assignment polling finds no assignment', async () => {
    const addSpy = vi.spyOn(runnerActivationTokenNotIssuedCount, 'add');

    try {
      await db()
        .update(providerRunners)
        .set({workspaceId: null})
        .where(eq(providerRunners.id, runnerInstanceId));

      const assignment = await getRunnerAssignment({runnerInstanceId, provisionerId});

      expect(assignment).toBeNull();
      expect(activationTokenMetricCalls(addSpy)).toHaveLength(0);
    } finally {
      addSpy.mockRestore();
    }
  });

  it('does not poll for an assignment while the runner is not running', async () => {
    const addSpy = vi.spyOn(runnerActivationTokenNotIssuedCount, 'add');

    try {
      await db()
        .update(providerRunners)
        .set({state: 'starting'})
        .where(eq(providerRunners.id, runnerInstanceId));

      const assignment = await getRunnerAssignment({runnerInstanceId, provisionerId});

      expect(assignment).toBeNull();
      expect(activationTokenMetricCalls(addSpy)).toHaveLength(0);
    } finally {
      addSpy.mockRestore();
    }
  });

  it('does not record a metric when activation-token issuance succeeds', async () => {
    const addSpy = vi.spyOn(runnerActivationTokenNotIssuedCount, 'add');

    try {
      const activationToken = await issueRunnerActivationToken({
        runnerInstanceId,
        provisionerId,
        ttlSeconds: 60,
        surface: 'poll',
      });

      expect(activationToken).toEqual(expect.any(String));
      expect(activationTokenMetricCalls(addSpy)).toHaveLength(0);
    } finally {
      addSpy.mockRestore();
    }
  });

  it('allows only one concurrent registration to consume an activation token', async () => {
    const rawToken = await issueRunnerActivationToken({
      runnerInstanceId,
      provisionerId,
      ttlSeconds: 60,
      surface: 'poll',
    });
    const [activationToken] = await db()
      .select()
      .from(runnerActivationTokens)
      .where(eq(runnerActivationTokens.runnerInstanceId, runnerInstanceId));
    if (!rawToken || !activationToken) throw new Error('Activation token was not created');

    const registrations = await Promise.allSettled([
      registerRunnerSession({
        auth: runnersTestAuthClient,
        credential: {kind: 'activation', activationTokenId: activationToken.id, workspaceId},
        labels: ['linux'],
      }),
      registerRunnerSession({
        auth: runnersTestAuthClient,
        credential: {kind: 'activation', activationTokenId: activationToken.id, workspaceId},
        labels: ['linux'],
      }),
    ]);

    const [storedToken] = await db()
      .select()
      .from(runnerActivationTokens)
      .where(eq(runnerActivationTokens.id, activationToken.id));
    const sessions = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.runnerInstanceId, runnerInstanceId));

    expect(
      registrations.filter((registration) => registration.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(registrations.filter((registration) => registration.status === 'rejected')).toHaveLength(
      1,
    );
    expect(storedToken?.consumedAt).toBeInstanceOf(Date);
    expect(sessions).toHaveLength(1);
  });

  it('strips reserved labels from workspace activation registration', async () => {
    const rawToken = await issueRunnerActivationToken({
      runnerInstanceId,
      provisionerId,
      ttlSeconds: 60,
      surface: 'poll',
    });
    const [activationToken] = await db()
      .select()
      .from(runnerActivationTokens)
      .where(eq(runnerActivationTokens.runnerInstanceId, runnerInstanceId));
    if (!rawToken || !activationToken) throw new Error('Activation token was not created');

    const result = await registerRunnerSession({
      auth: runnersTestAuthClient,
      credential: {kind: 'activation', activationTokenId: activationToken.id, workspaceId},
      labels: ['linux', 'shipfox-managed'],
    });

    expect(result.session.labels).toEqual(['linux']);
  });
});
