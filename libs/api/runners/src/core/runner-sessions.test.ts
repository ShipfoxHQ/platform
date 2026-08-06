import {and, eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {ephemeralRegistrationTokens} from '#db/schema/ephemeral-registration-tokens.js';
import {runnerActivationTokens} from '#db/schema/runner-activation-tokens.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
import {
  ephemeralRegistrationTokenFactory,
  getRunnerSessionTokenClaims,
  manualRegistrationTokenFactory,
  providerRunnerFactory,
  provisionerTokenFactory,
  runnersTestAuthClient,
} from '#test/index.js';
import {
  EmptyRunnerLabelsError,
  RegistrationTokenConsumedError,
  RegistrationTokenWorkspaceMismatchError,
  RunnerLabelsReservedError,
} from './errors.js';
import {issueRunnerActivationToken} from './runner-activation.js';
import {registerRunnerSession} from './runner-sessions.js';

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

  it('consumes an ephemeral token and creates a one-claim session', async () => {
    const token = await ephemeralRegistrationTokenFactory.create({workspaceId});

    const result = await registerRunnerSession({
      auth: runnersTestAuthClient,
      credential: {
        kind: 'ephemeral',
        ephemeralTokenId: token.id,
        workspaceId,
        provisionerId: token.provisionerId,
        reservationId: token.reservationId,
        providerRunnerId: token.providerRunnerId,
      },
      labels: [' Linux ', 'x64'],
    });

    expect(result.mode).toBe('ephemeral');
    expect(result.maxClaims).toBe(1);
    expect(result.session.registrationTokenKind).toBe('ephemeral');
    expect(result.session.provisionerId).toBe(token.provisionerId);
    expect(result.session.providerRunnerId).toBe(token.providerRunnerId);
    expect(result.session.maxClaims).toBe(1);
    expect(result.session.claimsUsed).toBe(0);

    const [consumed] = await db()
      .select()
      .from(ephemeralRegistrationTokens)
      .where(eq(ephemeralRegistrationTokens.id, token.id));
    expect(consumed?.consumedAt).toBeInstanceOf(Date);
    expect(consumed?.consumedSessionId).toBe(result.session.id);

    const [session] = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.id, result.session.id));
    expect(session?.provisionerId).toBe(token.provisionerId);
    expect(session?.providerRunnerId).toBe(token.providerRunnerId);

    const claims = getRunnerSessionTokenClaims(result.sessionToken);
    expect(claims?.maxClaims).toBe(1);
  });

  it('links an existing provisioned runner row when consuming an ephemeral token', async () => {
    const token = await ephemeralRegistrationTokenFactory.create({workspaceId});
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId: token.provisionerId,
      providerRunnerId: token.providerRunnerId,
      runnerSessionId: null,
      state: 'starting',
    });

    const result = await registerRunnerSession({
      auth: runnersTestAuthClient,
      credential: {
        kind: 'ephemeral',
        ephemeralTokenId: token.id,
        workspaceId,
        provisionerId: token.provisionerId,
        reservationId: token.reservationId,
        providerRunnerId: token.providerRunnerId,
      },
      labels: ['linux'],
    });

    const [providerRunner] = await db()
      .select()
      .from(providerRunners)
      .where(
        and(
          eq(providerRunners.workspaceId, workspaceId),
          eq(providerRunners.provisionerId, token.provisionerId),
          eq(providerRunners.providerRunnerId, token.providerRunnerId),
        ),
      );
    expect(providerRunner?.runnerSessionId).toBe(result.session.id);
  });

  it('rejects a second consume of the same ephemeral token', async () => {
    const token = await ephemeralRegistrationTokenFactory.create({workspaceId});
    const credential = {
      kind: 'ephemeral' as const,
      ephemeralTokenId: token.id,
      workspaceId,
      provisionerId: token.provisionerId,
      reservationId: token.reservationId,
      providerRunnerId: token.providerRunnerId,
    };

    await registerRunnerSession({auth: runnersTestAuthClient, credential, labels: ['linux']});

    await expect(
      registerRunnerSession({auth: runnersTestAuthClient, credential, labels: ['linux']}),
    ).rejects.toBeInstanceOf(RegistrationTokenConsumedError);
  });

  it('rejects consuming an ephemeral token for a different workspace', async () => {
    const token = await ephemeralRegistrationTokenFactory.create({workspaceId});

    await expect(
      registerRunnerSession({
        auth: runnersTestAuthClient,
        credential: {
          kind: 'ephemeral',
          ephemeralTokenId: token.id,
          workspaceId: crypto.randomUUID(),
          provisionerId: token.provisionerId,
          reservationId: token.reservationId,
          providerRunnerId: token.providerRunnerId,
        },
        labels: ['linux'],
      }),
    ).rejects.toBeInstanceOf(RegistrationTokenWorkspaceMismatchError);
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
    });
    const replacementToken = await issueRunnerActivationToken({
      runnerInstanceId,
      provisionerId,
      ttlSeconds: 60,
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

  it('allows only one concurrent registration to consume an activation token', async () => {
    const rawToken = await issueRunnerActivationToken({
      runnerInstanceId,
      provisionerId,
      ttlSeconds: 60,
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
