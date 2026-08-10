import {hashOpaqueToken} from '@shipfox/node-tokens';
import {eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {
  createProvisionerToken,
  listActiveProvisionerTokens,
  listUsableProvisionerTokensByWorkspaceId,
  resolveProvisionerTokenByHash,
  revokeProvisionerToken,
  touchProvisionerLastSeen,
} from '#db/provisioner-tokens.js';
import {provisionerTokens} from '#db/schema/provisioner-tokens.js';
import {reservations} from '#db/schema/reservations.js';
import {runnerActivationTokens} from '#db/schema/runner-activation-tokens.js';
import {runnerBootstrapTokens, runnerControlSessions} from '#db/schema/runner-control-sessions.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
import {providerRunnerFactory, provisionerTokenFactory} from '#test/index.js';

describe('provisioner token db', () => {
  it('creates and resolves a token', async () => {
    const workspaceId = crypto.randomUUID();
    const rawToken = 'sf_pt_test-token';
    const createdByUserId = crypto.randomUUID();
    const token = await createProvisionerToken({
      scope: 'workspace',
      workspaceId,
      hashedToken: hashOpaqueToken(rawToken),
      prefix: rawToken.slice(0, 12),
      name: 'scaler',
      createdByUserId,
    });

    const result = await resolveProvisionerTokenByHash(hashOpaqueToken(rawToken));

    expect(result?.id).toBe(token.id);
    expect(result?.workspaceId).toBe(workspaceId);
    expect(result?.createdByUserId).toBe(createdByUserId);
  });

  it('returns undefined when resolving an unknown token hash', async () => {
    const result = await resolveProvisionerTokenByHash(hashOpaqueToken('sf_pt_unknown-token'));

    expect(result).toBeUndefined();
  });

  it('creates installation factory tokens without a workspace', async () => {
    const token = await provisionerTokenFactory.create({scope: 'installation'});

    expect(token).toMatchObject({scope: 'installation', workspaceId: null});
  });

  it('enforces valid scope and workspace combinations in PostgreSQL', async () => {
    const insert = (scope: 'installation' | 'workspace', workspaceId: string | null) =>
      db()
        .insert(provisionerTokens)
        .values({
          scope,
          workspaceId,
          hashedToken: hashOpaqueToken(`${scope}-${workspaceId}`),
          prefix: 'sf_pt_invalid',
          createdByUserId: crypto.randomUUID(),
        });

    await expect(insert('installation', crypto.randomUUID())).rejects.toThrow();
    await expect(insert('workspace', null)).rejects.toThrow();
  });

  it('lists usable tokens for a workspace', async () => {
    const workspaceId = crypto.randomUUID();
    const usable = await provisionerTokenFactory.create({workspaceId, name: 'usable'});
    const expired = await provisionerTokenFactory.create({
      workspaceId,
      name: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const revoked = await provisionerTokenFactory.create({workspaceId, name: 'revoked'});
    await provisionerTokenFactory.create({
      workspaceId: crypto.randomUUID(),
      name: 'other workspace',
    });
    await revokeProvisionerToken({
      tokenId: revoked.id,
      workspaceId,
      revokedByUserId: crypto.randomUUID(),
    });

    const tokens = await listUsableProvisionerTokensByWorkspaceId(workspaceId);

    expect(tokens.map((token) => token.id)).toEqual([usable.id]);
    expect(tokens.map((token) => token.id)).not.toContain(expired.id);
  });

  it('revokes a token and records the revoking user', async () => {
    const workspaceId = crypto.randomUUID();
    const token = await provisionerTokenFactory.create({workspaceId});
    const revokedByUserId = crypto.randomUUID();

    const revoked = await revokeProvisionerToken({tokenId: token.id, workspaceId, revokedByUserId});

    expect(revoked?.id).toBe(token.id);
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
    expect(revoked?.revokedByUserId).toBe(revokedByUserId);
  });

  it("cascades revocation to the provisioner's unclaimed runner credentials and sessions", async () => {
    const workspaceId = crypto.randomUUID();
    const provisioner = await provisionerTokenFactory.create({workspaceId});
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId: provisioner.id,
        requiredLabels: ['linux'],
        count: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!reservation) throw new Error('Expected reservation');
    const runner = await providerRunnerFactory.create({
      workspaceId,
      provisionerId: provisioner.id,
      runnerSessionId: null,
      reservationId: reservation.id,
    });
    const future = new Date(Date.now() + 60_000);
    const tokenValue = (name: string) => hashOpaqueToken(`${name}-${crypto.randomUUID()}`);
    await db()
      .insert(runnerBootstrapTokens)
      .values({
        runnerInstanceId: runner.id,
        provisionerId: provisioner.id,
        hashedToken: tokenValue('bootstrap'),
        prefix: 'bootstrap',
        expiresAt: future,
      });
    await db()
      .insert(runnerControlSessions)
      .values({
        runnerInstanceId: runner.id,
        provisionerId: provisioner.id,
        hashedToken: tokenValue('control'),
        prefix: 'control',
        expiresAt: future,
      });
    await db()
      .insert(runnerActivationTokens)
      .values({
        runnerInstanceId: runner.id,
        hashedToken: tokenValue('activation'),
        prefix: 'activation',
        expiresAt: future,
      });
    const [unclaimedSession] = await db()
      .insert(runnerSessions)
      .values({
        workspaceId,
        scope: 'workspace',
        registrationTokenId: crypto.randomUUID(),
        registrationTokenKind: 'activation',
        runnerInstanceId: runner.id,
        provisionerId: provisioner.id,
        providerRunnerId: runner.providerRunnerId,
        labels: ['linux'],
        maxClaims: 1,
        claimsUsed: 0,
      })
      .returning();
    const [claimedSession] = await db()
      .insert(runnerSessions)
      .values({
        workspaceId,
        scope: 'workspace',
        registrationTokenId: crypto.randomUUID(),
        registrationTokenKind: 'activation',
        runnerInstanceId: crypto.randomUUID(),
        provisionerId: provisioner.id,
        providerRunnerId: crypto.randomUUID(),
        labels: ['linux'],
        maxClaims: 1,
        claimsUsed: 1,
      })
      .returning();
    if (!unclaimedSession || !claimedSession) throw new Error('Runner sessions were not created');

    await revokeProvisionerToken({
      tokenId: provisioner.id,
      workspaceId,
      revokedByUserId: crypto.randomUUID(),
    });

    const [bootstrap] = await db()
      .select()
      .from(runnerBootstrapTokens)
      .where(eq(runnerBootstrapTokens.runnerInstanceId, runner.id));
    const [control] = await db()
      .select()
      .from(runnerControlSessions)
      .where(eq(runnerControlSessions.runnerInstanceId, runner.id));
    const [activation] = await db()
      .select()
      .from(runnerActivationTokens)
      .where(eq(runnerActivationTokens.runnerInstanceId, runner.id));
    const [terminatedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    const [releasedReservation] = await db()
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservation.id));
    const [revokedSession] = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.id, unclaimedSession.id));
    const [preservedSession] = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.id, claimedSession.id));

    expect(bootstrap?.revokedAt).toBeInstanceOf(Date);
    expect(control).toMatchObject({closeReason: 'provisioner-revoked'});
    expect(control?.closedAt).toBeInstanceOf(Date);
    expect(activation?.revokedAt).toBeInstanceOf(Date);
    expect(terminatedRunner).toMatchObject({state: 'terminated'});
    expect(terminatedRunner?.terminatedAt).toBeInstanceOf(Date);
    expect(terminatedRunner?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(releasedReservation).toBeUndefined();
    expect(revokedSession?.revokedAt).toBeInstanceOf(Date);
    expect(preservedSession?.revokedAt).toBeNull();
  });

  it('preserves the original revocation audit fields on repeat revoke', async () => {
    const workspaceId = crypto.randomUUID();
    const token = await provisionerTokenFactory.create({workspaceId});
    const firstRevokedByUserId = crypto.randomUUID();
    const secondRevokedByUserId = crypto.randomUUID();

    const first = await revokeProvisionerToken({
      tokenId: token.id,
      workspaceId,
      revokedByUserId: firstRevokedByUserId,
    });
    const second = await revokeProvisionerToken({
      tokenId: token.id,
      workspaceId,
      revokedByUserId: secondRevokedByUserId,
    });

    expect(second?.id).toBe(token.id);
    expect(second?.revokedAt?.toISOString()).toBe(first?.revokedAt?.toISOString());
    expect(second?.revokedByUserId).toBe(firstRevokedByUserId);
  });

  it('touches last seen only after the throttle window', async () => {
    const workspaceId = crypto.randomUUID();
    const token = await provisionerTokenFactory.create({workspaceId});

    await touchProvisionerLastSeen({tokenId: token.id, throttleSeconds: 10});
    const first = await resolveProvisionerTokenByHash(token.hashedToken);
    await touchProvisionerLastSeen({tokenId: token.id, throttleSeconds: 10});
    const second = await resolveProvisionerTokenByHash(token.hashedToken);

    expect(first?.lastSeenAt).toBeInstanceOf(Date);
    expect(second?.lastSeenAt?.toISOString()).toBe(first?.lastSeenAt?.toISOString());
  });

  it('lists active usable provisioner tokens', async () => {
    const workspaceId = crypto.randomUUID();
    const active = await provisionerTokenFactory.create({workspaceId, name: 'active'});
    const stale = await provisionerTokenFactory.create({workspaceId, name: 'stale'});
    const revoked = await provisionerTokenFactory.create({workspaceId, name: 'revoked'});
    await touchProvisionerLastSeen({tokenId: active.id, throttleSeconds: 10});
    await touchProvisionerLastSeen({tokenId: stale.id, throttleSeconds: 10});
    await touchProvisionerLastSeen({tokenId: revoked.id, throttleSeconds: 10});
    await db().execute(
      sql`UPDATE runners_provisioner_tokens SET last_seen_at = now() - interval '10 minutes' WHERE id = ${stale.id}`,
    );
    await revokeProvisionerToken({
      tokenId: revoked.id,
      workspaceId,
      revokedByUserId: crypto.randomUUID(),
    });

    const tokens = await listActiveProvisionerTokens({workspaceId, windowSeconds: 120});

    expect(tokens.map((token) => token.id)).toEqual([active.id]);
  });
});
