import {vi} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {ephemeralRegistrationTokens} from '#db/schema/ephemeral-registration-tokens.js';
import {reservations} from '#db/schema/reservations.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
import {providerRunnerReapedCount, reservationReleasedCount} from '#metrics/instance.js';
import {providerRunnerFactory, provisionerTokenFactory, reservationFactory} from '#test/index.js';
import {
  deleteExpiredEphemeralRegistrationTokens,
  deleteExpiredRunnerReservations,
  deleteExpiredRunnerSessions,
  reapStaleRunnerInstances,
} from './maintenance.js';

describe('deleteExpiredRunnerReservations', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
  });

  it('deletes expired reservations and keeps active reservations', async () => {
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux', 'gpu'],
      count: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await deleteExpiredRunnerReservations();

    const remaining = await db()
      .select()
      .from(reservations)
      .where(eq(reservations.workspaceId, workspaceId));
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.requiredLabels).toEqual(['linux', 'gpu']);
  });
});

describe('reapStaleRunnerInstances', () => {
  it('returns reaped counts and records maintenance metrics', async () => {
    const workspaceId = crypto.randomUUID();
    const provisioner = await provisionerTokenFactory.create({workspaceId});
    await reservationFactory.create({
      workspaceId,
      provisionerId: provisioner.id,
      requiredLabels: ['linux'],
      count: 2,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [reservation] = await db()
      .select()
      .from(reservations)
      .where(eq(reservations.workspaceId, workspaceId));
    if (!reservation) throw new Error('Expected reservation');
    const providerRunner = await providerRunnerFactory.create({
      workspaceId,
      provisionerId: provisioner.id,
      providerRunnerId: 'provisioned-runner-1',
      reservationId: reservation.id,
      reportedAt: new Date(Date.now() - 120_000),
    });
    await db()
      .update(providerRunners)
      .set({updatedAt: new Date(Date.now() - 120_000)})
      .where(eq(providerRunners.id, providerRunner.id));
    const reapedSpy = vi.spyOn(providerRunnerReapedCount, 'add');
    const releasedSpy = vi.spyOn(reservationReleasedCount, 'add');

    const result = await reapStaleRunnerInstances({thresholdSeconds: 60, limit: 100});

    expect(result).toEqual({reaped: 1, reservationsReleased: 1});
    expect(reapedSpy).toHaveBeenCalledWith(1);
    expect(releasedSpy).toHaveBeenCalledWith(1, {surface: 'reconcile'});
  });
});

describe('deleteExpiredRunnerSessions', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  it('deletes expired runner sessions using default retention policy', async () => {
    const manualId = crypto.randomUUID();
    const ephemeralId = crypto.randomUUID();
    await db()
      .insert(runnerSessions)
      .values([
        buildRunnerSession({
          id: manualId,
          kind: 'manual',
          createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        }),
        buildRunnerSession({
          id: ephemeralId,
          kind: 'ephemeral',
          createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        }),
      ]);

    const result = await deleteExpiredRunnerSessions();

    const remaining = await db()
      .select({id: runnerSessions.id})
      .from(runnerSessions)
      .where(eq(runnerSessions.workspaceId, workspaceId));
    expect(result.deleted).toBeGreaterThanOrEqual(2);
    expect(remaining).toEqual([]);
  });

  it('passes explicit retention and limit values to the DB cleanup', async () => {
    const deleteableId = crypto.randomUUID();
    const keptId = crypto.randomUUID();
    await db()
      .insert(runnerSessions)
      .values([
        buildRunnerSession({
          id: deleteableId,
          kind: 'manual',
          createdAt: new Date(Date.now() - 3650 * 24 * 60 * 60 * 1000),
        }),
        buildRunnerSession({
          id: keptId,
          kind: 'manual',
          createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
        }),
      ]);

    const result = await deleteExpiredRunnerSessions({
      manualRetentionDays: 5,
      ephemeralRetentionDays: 7,
      limit: 1,
    });

    const remaining = await db()
      .select({id: runnerSessions.id})
      .from(runnerSessions)
      .where(eq(runnerSessions.workspaceId, workspaceId));
    expect(result.deleted).toBe(1);
    expect(remaining.map((row) => row.id)).toEqual([keptId]);
  });

  function buildRunnerSession(params: {
    id: string;
    kind: 'manual' | 'ephemeral';
    createdAt: Date;
  }): typeof runnerSessions.$inferInsert {
    const provisionerId = params.kind === 'ephemeral' ? crypto.randomUUID() : null;
    return {
      id: params.id,
      workspaceId,
      scope: 'workspace',
      registrationTokenId: crypto.randomUUID(),
      registrationTokenKind: params.kind,
      provisionerId,
      providerRunnerId: params.kind === 'ephemeral' ? `provisioned-${params.id}` : null,
      labels: ['linux'],
      maxClaims: params.kind === 'ephemeral' ? 1 : null,
      claimsUsed: 0,
      createdAt: params.createdAt,
      updatedAt: params.createdAt,
    };
  }
});

describe('deleteExpiredEphemeralRegistrationTokens', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  it('deletes expired ephemeral tokens using the default retention policy', async () => {
    const staleId = crypto.randomUUID();
    await db()
      .insert(ephemeralRegistrationTokens)
      .values(
        buildEphemeralToken({
          id: staleId,
          expiresAt: new Date(Date.now() - 8 * DAY_MS),
        }),
      );

    const result = await deleteExpiredEphemeralRegistrationTokens();

    const remaining = await db()
      .select({id: ephemeralRegistrationTokens.id})
      .from(ephemeralRegistrationTokens)
      .where(eq(ephemeralRegistrationTokens.workspaceId, workspaceId));
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(remaining).toEqual([]);
  });

  it('passes explicit retention and limit values to the DB cleanup', async () => {
    const deletableId = crypto.randomUUID();
    const keptId = crypto.randomUUID();
    await db()
      .insert(ephemeralRegistrationTokens)
      .values([
        buildEphemeralToken({id: deletableId, expiresAt: new Date(Date.now() - 3650 * DAY_MS)}),
        buildEphemeralToken({id: keptId, expiresAt: new Date(Date.now() - 4 * DAY_MS)}),
      ]);

    const result = await deleteExpiredEphemeralRegistrationTokens({retentionDays: 5, limit: 1});

    const remaining = await db()
      .select({id: ephemeralRegistrationTokens.id})
      .from(ephemeralRegistrationTokens)
      .where(eq(ephemeralRegistrationTokens.workspaceId, workspaceId));
    expect(result.deleted).toBe(1);
    expect(remaining.map((row) => row.id)).toEqual([keptId]);
  });

  function buildEphemeralToken(params: {
    id: string;
    expiresAt: Date;
  }): typeof ephemeralRegistrationTokens.$inferInsert {
    return {
      id: params.id,
      workspaceId,
      provisionerId: crypto.randomUUID(),
      providerRunnerId: `provisioned-${params.id}`,
      hashedToken: crypto.randomUUID(),
      prefix: 'sfxr_test',
      expiresAt: params.expiresAt,
      consumedAt: null,
      createdAt: params.expiresAt,
    };
  }
});
