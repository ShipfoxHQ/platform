import {vi} from '@shipfox/vitest/vi';
import {and, eq, inArray, or, sql, sum} from 'drizzle-orm';
import {db} from '#db/db.js';
import {
  deleteExpiredReservations,
  deleteReservationsByIds,
  pollDemandAndReserve,
  pollInstallationDemandAndReserve,
  releaseReservationUnits,
} from '#db/reservations.js';
import {pendingJobExecutions} from '#db/schema/pending-job-executions.js';
import {reservations} from '#db/schema/reservations.js';
import {runnerActivationTokens} from '#db/schema/runner-activation-tokens.js';
import {runnerControlSessions} from '#db/schema/runner-control-sessions.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {providerRunnerActivationOutcomeCount} from '#metrics/instance.js';
import {pendingJobFactory, reservationFactory} from '#test/index.js';

describe('pollDemandAndReserve', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
  });

  it('caps grants by unreserved demand, available slots, and max reservations', async () => {
    await createPendingJobs(50, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 100,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 20)],
    });

    expect(result.reservations).toHaveLength(1);
    expect(result.reservations[0]?.count).toBe(20);
    expect(result.stats[0]).toMatchObject({labels: ['linux'], queued: 50, reserved: 20});
  });

  it('binds the oldest matching enrolled runners and returns only the launch remainder', async () => {
    const olderRunner = await createIdleRunner({
      labels: ['linux'],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const newerRunner = await createIdleRunner({
      labels: ['linux'],
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    const unmatchedRunner = await createIdleRunner({
      labels: ['macos'],
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    });
    await createPendingJobs(3, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 3,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 3)],
    });

    const rows = await db()
      .select()
      .from(providerRunners)
      .where(inArray(providerRunners.id, [olderRunner.id, newerRunner.id, unmatchedRunner.id]));
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const [boundReservation] = await db()
      .select()
      .from(reservations)
      .where(and(eq(reservations.workspaceId, workspaceId), eq(reservations.kind, 'bound')));
    const [launchReservation] = await db()
      .select()
      .from(reservations)
      .where(and(eq(reservations.workspaceId, workspaceId), eq(reservations.kind, 'launch')));
    const reservationId = boundReservation?.id;

    expect(reservationId).toEqual(expect.any(String));
    expect(result.reservations).toEqual([
      expect.objectContaining({reservationId: launchReservation?.id, count: 1}),
    ]);
    expect(boundReservation).toMatchObject({kind: 'bound', count: 2});
    expect(rowsById.get(olderRunner.id)).toMatchObject({
      workspaceId,
      reservationId,
      assignedAt: expect.any(Date),
    });
    expect(rowsById.get(newerRunner.id)).toMatchObject({
      workspaceId,
      reservationId,
      assignedAt: expect.any(Date),
    });
    expect(rowsById.get(unmatchedRunner.id)).toMatchObject({
      workspaceId: null,
      reservationId: null,
      assignedAt: null,
    });
  });

  it('splits rebound and launch capacity with separate reservation lifetimes', async () => {
    const runner = await createIdleRunner({labels: ['linux']});
    await createPendingJobs(2, ['linux']);

    const before = Date.now();
    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 2,
      ttlSeconds: 120,
      activationGraceSeconds: 5,
      templates: [template('linux', ['linux'], 2)],
    });

    expect(result.reservations).toHaveLength(1);
    expect(result.reservations[0]).toMatchObject({count: 1});
    const rows = await db()
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.workspaceId, workspaceId),
          eq(reservations.provisionerId, provisionerId),
        ),
      );
    const boundReservation = rows.find((row) => row.kind === 'bound');
    const launchReservation = rows.find((row) => row.kind === 'launch');
    expect(boundReservation).toMatchObject({count: 1});
    expect(launchReservation).toMatchObject({count: 1});
    expect(boundReservation?.expiresAt.getTime()).toBeGreaterThan(before + 4_000);
    expect(boundReservation?.expiresAt.getTime()).toBeLessThan(
      launchReservation?.expiresAt.getTime() ?? 0,
    );
    expect(launchReservation?.id).toBe(result.reservations[0]?.reservationId);
    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    expect(storedRunner?.reservationId).toBe(boundReservation?.id);
  });

  it('records a rebound outcome for a demand-backed idle runner', async () => {
    const outcomeSpy = vi.spyOn(providerRunnerActivationOutcomeCount, 'add');
    await createIdleRunner({labels: ['linux'], launchKind: 'demand'});
    await createPendingJobs(1, ['linux']);
    const callsBefore = outcomeSpy.mock.calls.length;

    await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    expect(
      outcomeSpy.mock.calls
        .slice(callsBefore)
        .filter(
          ([value, attributes]) =>
            value === 1 && JSON.stringify(attributes) === JSON.stringify({outcome: 'rebound'}),
        ),
    ).toHaveLength(1);
  });

  it('does not charge adopted runners against later launch capacity', async () => {
    const adoptedRunner = await createIdleRunner({labels: ['linux', 'gpu']});
    await createPendingJobs(1, ['linux', 'gpu']);
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 2,
      ttlSeconds: 60,
      templates: [template('linux-gpu', ['linux', 'gpu'], 1)],
    });

    const storedReservations = await reservationsForTest();
    const boundReservation = storedReservations.find(
      (reservation) => reservation.requiredLabels.includes('gpu') && reservation.kind === 'bound',
    );
    const launchReservation = storedReservations.find(
      (reservation) => !reservation.requiredLabels.includes('gpu') && reservation.kind === 'launch',
    );
    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, adoptedRunner.id));

    expect(result.reservations).toEqual([
      expect.objectContaining({
        reservationId: launchReservation?.id,
        labels: ['linux'],
        count: 1,
      }),
    ]);
    expect(boundReservation).toMatchObject({kind: 'bound', count: 1});
    expect(storedRunner?.reservationId).toBe(boundReservation?.id);
  });

  it('binds a runner whose intended reservation has passed its activation grace period', async () => {
    const intendedReservation = await createIntendedReservation({
      workspaceId,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const runner = await createIdleRunner({
      labels: ['linux'],
      intendedReservationId: intendedReservation.id,
    });
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    expect(result.reservations).toEqual([]);
    expect(storedRunner).toMatchObject({
      workspaceId,
      reservationId: expect.any(String),
      intendedReservationId: null,
      assignedAt: expect.any(Date),
    });
  });

  it('binds a runner whose intended reservation was deleted after its grace period', async () => {
    const intendedReservation = await createIntendedReservation({
      workspaceId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db().delete(reservations).where(eq(reservations.id, intendedReservation.id));
    const runner = await createIdleRunner({
      labels: ['linux'],
      intendedReservationId: intendedReservation.id,
    });
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    expect(result.reservations).toEqual([]);
    expect(storedRunner).toMatchObject({
      workspaceId,
      reservationId: expect.any(String),
      intendedReservationId: null,
      assignedAt: expect.any(Date),
    });
  });

  it('binds an assigned runner after its reservation grace period expires', async () => {
    const staleReservation = await createIntendedReservation({
      workspaceId,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const runner = await createIdleRunner({
      labels: ['linux'],
      workspaceId,
      reservationId: staleReservation.id,
      intendedReservationId: staleReservation.id,
    });
    const [activationToken] = await db()
      .insert(runnerActivationTokens)
      .values({
        runnerInstanceId: runner.id,
        hashedToken: crypto.randomUUID(),
        prefix: 'test',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!activationToken) throw new Error('Expected activation token');
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    const [storedToken] = await db()
      .select()
      .from(runnerActivationTokens)
      .where(eq(runnerActivationTokens.id, activationToken.id));
    expect(result.reservations).toEqual([]);
    expect(storedRunner).toMatchObject({
      workspaceId,
      reservationId: expect.any(String),
      intendedReservationId: null,
      assignedAt: expect.any(Date),
    });
    expect(storedToken?.revokedAt).toBeInstanceOf(Date);
  });

  it('binds an assigned runner whose reservation was deleted', async () => {
    const staleReservation = await createIntendedReservation({
      workspaceId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db().delete(reservations).where(eq(reservations.id, staleReservation.id));
    const runner = await createIdleRunner({
      labels: ['linux'],
      workspaceId,
      reservationId: staleReservation.id,
      intendedReservationId: staleReservation.id,
    });
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    expect(result.reservations).toEqual([]);
    expect(storedRunner).toMatchObject({
      workspaceId,
      reservationId: expect.any(String),
      intendedReservationId: null,
      assignedAt: expect.any(Date),
    });
  });

  it('does not bind an assigned runner within its activation grace period', async () => {
    const liveReservation = await createIntendedReservation({
      workspaceId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const runner = await createIdleRunner({
      labels: ['linux'],
      workspaceId,
      reservationId: liveReservation.id,
    });
    await createPendingJobs(2, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 2,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 2)],
    });

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    expect(result.reservations[0]?.count).toBe(1);
    expect(storedRunner).toMatchObject({
      workspaceId,
      reservationId: liveReservation.id,
      intendedReservationId: null,
      assignedAt: null,
    });
  });

  it('does not bind a runner whose intended reservation is within its activation grace period', async () => {
    const intendedReservation = await createIntendedReservation({
      workspaceId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const runner = await createIdleRunner({
      labels: ['linux'],
      intendedReservationId: intendedReservation.id,
    });
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    expect(result.reservations[0]?.count).toBe(1);
    expect(storedRunner).toMatchObject({
      workspaceId: null,
      reservationId: null,
      intendedReservationId: intendedReservation.id,
      assignedAt: null,
    });
  });

  it('does not rebind a stale runner from another workspace in a workspace-scoped poll', async () => {
    const previousWorkspaceId = crypto.randomUUID();
    const staleReservation = await createIntendedReservation({
      workspaceId: previousWorkspaceId,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const runner = await createIdleRunner({
      labels: ['linux'],
      workspaceId: previousWorkspaceId,
      reservationId: staleReservation.id,
      intendedReservationId: staleReservation.id,
    });
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    expect(result.reservations[0]?.count).toBe(1);
    expect(storedRunner).toMatchObject({
      workspaceId: previousWorkspaceId,
      reservationId: staleReservation.id,
      intendedReservationId: staleReservation.id,
    });
  });

  it('rebinds an unowned runner whose reservation was deleted', async () => {
    const runner = await createIdleRunner({
      labels: ['linux'],
      reservationId: crypto.randomUUID(),
    });
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    expect(result.reservations).toEqual([]);
    expect(storedRunner).toMatchObject({
      workspaceId,
      reservationId: expect.any(String),
      intendedReservationId: null,
      assignedAt: expect.any(Date),
    });
  });

  it('rebinds a stale runner across workspaces for an installation-scoped poll', async () => {
    const previousWorkspaceId = crypto.randomUUID();
    const targetWorkspaceId = crypto.randomUUID();
    const staleReservation = await createIntendedReservation({
      workspaceId: previousWorkspaceId,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const runner = await createIdleRunner({
      labels: ['linux'],
      workspaceId: previousWorkspaceId,
      reservationId: staleReservation.id,
      intendedReservationId: staleReservation.id,
    });
    await pendingJobFactory.create({workspaceId: targetWorkspaceId, requiredLabels: ['linux']});

    const result = await pollInstallationDemandAndReserve({
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
      capabilityWindowSeconds: 60,
      eligibleWorkspaceIds: new Set([targetWorkspaceId]),
    });

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    const [storedReservation] = await db()
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.workspaceId, targetWorkspaceId),
          eq(reservations.provisionerId, provisionerId),
          eq(reservations.kind, 'bound'),
        ),
      );
    expect(result.reservations).toEqual([]);
    expect(storedReservation).toMatchObject({workspaceId: targetWorkspaceId, count: 1});
    expect(storedRunner).toMatchObject({
      workspaceId: targetWorkspaceId,
      reservationId: storedReservation?.id,
      intendedReservationId: null,
      assignedAt: expect.any(Date),
    });
  });

  it.each([
    ['template capacity', 5, 2],
    ['global reservation budget', 2, 5],
  ])('counts rebound installation capacity against the %s', async (_case, maxReservations, availableSlots) => {
    const reboundWorkspaceId = crypto.randomUUID();
    const launchWorkspaceId = crypto.randomUUID();
    await pendingJobFactory.create({
      workspaceId: reboundWorkspaceId,
      requiredLabels: ['linux'],
    });
    await pendingJobFactory.create({
      workspaceId: launchWorkspaceId,
      requiredLabels: ['linux'],
    });
    await pendingJobFactory.create({
      workspaceId: launchWorkspaceId,
      requiredLabels: ['linux'],
    });
    await db()
      .update(pendingJobExecutions)
      .set({createdAt: new Date('2026-01-01T00:00:00.000Z')})
      .where(eq(pendingJobExecutions.workspaceId, reboundWorkspaceId));
    await db()
      .update(pendingJobExecutions)
      .set({createdAt: new Date('2026-01-02T00:00:00.000Z')})
      .where(eq(pendingJobExecutions.workspaceId, launchWorkspaceId));
    await createIdleRunner({labels: ['linux']});

    const result = await pollInstallationDemandAndReserve({
      provisionerId,
      maxReservations,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], availableSlots)],
      capabilityWindowSeconds: 60,
      eligibleWorkspaceIds: new Set([reboundWorkspaceId, launchWorkspaceId]),
    });

    const storedReservations = await db()
      .select()
      .from(reservations)
      .where(eq(reservations.provisionerId, provisionerId));
    expect(result.reservations).toEqual([
      expect.objectContaining({workspaceId: launchWorkspaceId, count: 1}),
    ]);
    expect(storedReservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({workspaceId: reboundWorkspaceId, kind: 'bound', count: 1}),
        expect.objectContaining({workspaceId: launchWorkspaceId, kind: 'launch', count: 1}),
      ]),
    );
  });

  it('does not rebind a released runner after its reservation expires', async () => {
    const staleReservation = await createIntendedReservation({
      workspaceId,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const releasedAt = new Date(Date.now() - 30_000);
    const runner = await createIdleRunner({
      labels: ['linux'],
      launchKind: 'demand',
      workspaceId,
      reservationId: staleReservation.id,
      intendedReservationId: staleReservation.id,
      reservationReleasedAt: releasedAt,
    });
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    expect(result.reservations[0]?.count).toBe(1);
    expect(storedRunner).toMatchObject({
      workspaceId,
      reservationId: staleReservation.id,
      intendedReservationId: staleReservation.id,
      reservationReleasedAt: releasedAt,
    });
  });

  it('does not bind a running runner without an active control session', async () => {
    const [runner] = await db()
      .insert(providerRunners)
      .values({
        provisionerId,
        providerRunnerId: 'un-enrolled-runner',
        labels: ['linux'],
        state: 'running',
        reportedAt: new Date(),
      })
      .returning();
    if (!runner) throw new Error('Expected runner instance');
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    expect(result.reservations[0]?.count).toBe(1);
    expect(storedRunner).toMatchObject({workspaceId: null, reservationId: null});
  });

  it('does not bind a runner with an expired control session', async () => {
    const runner = await createIdleRunner({
      labels: ['linux'],
      controlSessionExpiresAt: new Date(Date.now() - 60_000),
    });
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    expect(result.reservations[0]?.count).toBe(1);
    expect(storedRunner).toMatchObject({workspaceId: null, reservationId: null});
  });

  it('does not grant another reservation after idle runners are covered', async () => {
    await createIdleRunner({labels: ['linux']});
    await createPendingJobs(1, ['linux']);

    const firstResult = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });
    const secondResult = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    expect(firstResult.reservations).toEqual([]);
    expect(secondResult.reservations).toEqual([]);
    expect(secondResult.stats[0]).toMatchObject({queued: 1, reserved: 1});
    expect(await activeReservedCount()).toBe(1);
  });

  it('allocates overlapping label sets most-specific-first', async () => {
    await createPendingJobs(2, ['linux']);
    await createPendingJobs(1, ['linux', 'gpu']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 2,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1), template('linux-gpu', ['linux', 'gpu'], 1)],
    });

    expect(result.reservations).toEqual([
      expect.objectContaining({labels: ['gpu', 'linux'], count: 1}),
      expect.objectContaining({labels: ['linux'], count: 1}),
    ]);
  });

  it('serializes multiple provisioners so total active reservations do not exceed queued demand', async () => {
    await createPendingJobs(5, ['linux']);

    await Promise.all([
      pollDemandAndReserve({
        workspaceId,
        provisionerId: crypto.randomUUID(),
        maxReservations: 5,
        ttlSeconds: 60,
        templates: [template('linux-a', ['linux'], 5)],
      }),
      pollDemandAndReserve({
        workspaceId,
        provisionerId: crypto.randomUUID(),
        maxReservations: 5,
        ttlSeconds: 60,
        templates: [template('linux-b', ['linux'], 5)],
      }),
    ]);

    const reserved = await activeReservedCount();
    expect(reserved).toBeLessThanOrEqual(5);
  });

  it('allocates eligible workspace heads in oldest-demand order without overselling templates', async () => {
    const olderWorkspaceId = crypto.randomUUID();
    const newerWorkspaceId = crypto.randomUUID();
    await pendingJobFactory.create({workspaceId: olderWorkspaceId, requiredLabels: ['linux']});
    await pendingJobFactory.create({workspaceId: newerWorkspaceId, requiredLabels: ['linux']});

    const result = await pollInstallationDemandAndReserve({
      provisionerId,
      maxReservations: 5,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
      capabilityWindowSeconds: 60,
      eligibleWorkspaceIds: new Set([olderWorkspaceId, newerWorkspaceId]),
    });

    expect(result.reservations).toEqual([
      expect.objectContaining({workspaceId: olderWorkspaceId, labels: ['linux'], count: 1}),
    ]);
  });

  it('does not charge adopted installation runners against later launch capacity', async () => {
    const olderWorkspaceId = crypto.randomUUID();
    const newerWorkspaceId = crypto.randomUUID();
    const runner = await createIdleRunner({labels: ['linux', 'gpu']});
    await pendingJobFactory.create({
      workspaceId: olderWorkspaceId,
      requiredLabels: ['linux', 'gpu'],
    });
    await pendingJobFactory.create({workspaceId: newerWorkspaceId, requiredLabels: ['linux']});

    const result = await pollInstallationDemandAndReserve({
      provisionerId,
      maxReservations: 2,
      ttlSeconds: 60,
      templates: [template('linux-gpu', ['linux', 'gpu'], 1)],
      capabilityWindowSeconds: 60,
      eligibleWorkspaceIds: new Set([olderWorkspaceId, newerWorkspaceId]),
    });

    const storedReservations = await db()
      .select()
      .from(reservations)
      .where(eq(reservations.provisionerId, provisionerId));
    const boundReservation = storedReservations.find(
      (reservation) => reservation.workspaceId === olderWorkspaceId,
    );
    const launchReservation = storedReservations.find(
      (reservation) => reservation.workspaceId === newerWorkspaceId,
    );
    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));

    expect(result.reservations).toEqual([
      expect.objectContaining({
        reservationId: launchReservation?.id,
        workspaceId: newerWorkspaceId,
        labels: ['linux'],
        count: 1,
      }),
    ]);
    expect(boundReservation?.count).toBe(1);
    expect(storedRunner?.workspaceId).toBe(olderWorkspaceId);
    expect(storedRunner?.reservationId).toBe(boundReservation?.id);
  });

  it('reports committed installation grants before an aborted poll stops allocating', async () => {
    const firstWorkspaceId = crypto.randomUUID();
    const secondWorkspaceId = crypto.randomUUID();
    const abortController = new AbortController();
    const reportedReservations: string[] = [];
    await pendingJobFactory.create({workspaceId: firstWorkspaceId, requiredLabels: ['linux']});
    await pendingJobFactory.create({workspaceId: secondWorkspaceId, requiredLabels: ['linux']});

    const result = await pollInstallationDemandAndReserve({
      provisionerId,
      maxReservations: 2,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 2)],
      capabilityWindowSeconds: 60,
      eligibleWorkspaceIds: new Set([firstWorkspaceId, secondWorkspaceId]),
      signal: abortController.signal,
      onReservations: (reservations) => {
        reportedReservations.push(...reservations.map((reservation) => reservation.reservationId));
        abortController.abort();
      },
    });

    expect(result.reservations).toHaveLength(1);
    expect(reportedReservations).toEqual(
      result.reservations.map((reservation) => reservation.reservationId),
    );
  });

  it('does not count expired reservations against demand', async () => {
    await createPendingJobs(1, ['linux']);
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    expect(result.reservations).toHaveLength(1);
    expect(result.reservations[0]?.count).toBe(1);
    expect(result.stats[0]).toMatchObject({queued: 1, reserved: 1});
  });

  it('deducts this provisioner active reservations from advertised capacity', async () => {
    await createPendingJobs(10, ['linux']);
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count: 5,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 5,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 5)],
    });

    const reserved = await activeReservedCount();
    expect(result.reservations).toEqual([]);
    expect(result.stats[0]).toMatchObject({queued: 10, reserved: 5});
    expect(reserved).toBe(5);
  });

  it('returns multiple reservation groups in one response', async () => {
    await createPendingJobs(2, ['linux']);
    await createPendingJobs(1, ['macos']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 3,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 2), template('macos', ['macos'], 1)],
    });

    expect(result.reservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({labels: ['linux'], count: 2}),
        expect.objectContaining({labels: ['macos'], count: 1}),
      ]),
    );
  });

  it('splits max reservation budget across groups after the most-specific group', async () => {
    await createPendingJobs(3, ['linux', 'gpu']);
    await createPendingJobs(3, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 4,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 10), template('linux-gpu', ['linux', 'gpu'], 10)],
    });

    expect(result.reservations).toEqual([
      expect.objectContaining({labels: ['gpu', 'linux'], count: 3}),
      expect.objectContaining({labels: ['linux'], count: 1}),
    ]);
  });

  it('excludes demand that no template can satisfy from stats', async () => {
    await createPendingJobs(1, ['windows']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    expect(result).toEqual({stats: [], reservations: []});
  });

  it('returns stats without writing rows when max reservations is zero', async () => {
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 0,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    const reserved = await activeReservedCount();
    expect(result.stats).toEqual([
      expect.objectContaining({labels: ['linux'], queued: 1, reserved: 0}),
    ]);
    expect(result.reservations).toEqual([]);
    expect(reserved).toBe(0);
  });

  it('sets reservation expiry from database time', async () => {
    await createPendingJobs(1, ['linux']);
    const before = Date.now();

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    const expiresAt = result.reservations[0]?.expiresAt;
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt?.getTime()).toBeGreaterThan(before + 50_000);
  });

  it('deletes reservations by id', async () => {
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['macos'],
      count: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const beforeDelete = await reservationsForTest();
    const deletedReservation = beforeDelete.find((reservation) =>
      reservation.requiredLabels.includes('linux'),
    );
    if (!deletedReservation) throw new Error('Expected linux reservation');

    const deleted = await deleteReservationsByIds([deletedReservation.id]);

    const remaining = await reservationsForTest();
    expect(deleted).toBe(1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.requiredLabels).toEqual(['macos']);
  });

  it('unbinds prewarmed runners and revokes activation tokens when deleting a reservation', async () => {
    const runner = await createIdleRunner({labels: ['linux']});
    await createPendingJobs(1, ['linux']);

    await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });
    const [boundReservation] = await db()
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.workspaceId, workspaceId),
          eq(reservations.provisionerId, provisionerId),
          eq(reservations.kind, 'bound'),
        ),
      );
    const reservationId = boundReservation?.id;
    if (!reservationId) throw new Error('Expected bound reservation');

    const [activationToken] = await db()
      .insert(runnerActivationTokens)
      .values({
        runnerInstanceId: runner.id,
        hashedToken: crypto.randomUUID(),
        prefix: 'test',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!activationToken) throw new Error('Expected activation token');

    const deleted = await deleteReservationsByIds([reservationId]);

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    const [storedToken] = await db()
      .select()
      .from(runnerActivationTokens)
      .where(eq(runnerActivationTokens.id, activationToken.id));
    expect(deleted).toBe(1);
    expect(storedRunner).toMatchObject({
      workspaceId: null,
      reservationId: null,
      assignedAt: null,
    });
    expect(storedToken?.revokedAt).toBeInstanceOf(Date);
  });

  it('preserves activation tokens for active runners with an intended reservation', async () => {
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: ['linux'],
        count: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!reservation) throw new Error('Expected reservation');
    const [runner] = await db()
      .insert(providerRunners)
      .values({
        workspaceId,
        provisionerId,
        providerRunnerId: crypto.randomUUID(),
        reservationId: reservation.id,
        intendedReservationId: reservation.id,
        runnerSessionId: crypto.randomUUID(),
        labels: ['linux'],
        state: 'running',
        reportedAt: new Date(),
      })
      .returning();
    if (!runner) throw new Error('Expected runner instance');
    const [activationToken] = await db()
      .insert(runnerActivationTokens)
      .values({
        runnerInstanceId: runner.id,
        hashedToken: crypto.randomUUID(),
        prefix: 'test',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!activationToken) throw new Error('Expected activation token');

    const deleted = await deleteReservationsByIds([reservation.id]);

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    const [storedToken] = await db()
      .select()
      .from(runnerActivationTokens)
      .where(eq(runnerActivationTokens.id, activationToken.id));
    expect(deleted).toBe(1);
    expect(storedRunner).toMatchObject({
      reservationId: reservation.id,
      intendedReservationId: null,
      runnerSessionId: expect.any(String),
      reservationReleasedAt: null,
    });
    expect(storedToken?.revokedAt).toBeNull();
  });

  it('unbinds prewarmed runners and revokes activation tokens when deleting expired reservations', async () => {
    const runner = await createIdleRunner({labels: ['linux']});
    await createPendingJobs(1, ['linux']);

    await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });
    const [boundReservation] = await db()
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.workspaceId, workspaceId),
          eq(reservations.provisionerId, provisionerId),
          eq(reservations.kind, 'bound'),
        ),
      );
    const reservationId = boundReservation?.id;
    if (!reservationId) throw new Error('Expected bound reservation');

    await db()
      .update(reservations)
      .set({expiresAt: new Date(Date.now() - 60_000)})
      .where(eq(reservations.id, reservationId));
    const [activationToken] = await db()
      .insert(runnerActivationTokens)
      .values({
        runnerInstanceId: runner.id,
        hashedToken: crypto.randomUUID(),
        prefix: 'test',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!activationToken) throw new Error('Expected activation token');

    const deleted = await deleteExpiredReservations();

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    const [storedToken] = await db()
      .select()
      .from(runnerActivationTokens)
      .where(eq(runnerActivationTokens.id, activationToken.id));
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(storedRunner).toMatchObject({
      workspaceId: null,
      reservationId: null,
      assignedAt: null,
    });
    expect(storedToken?.revokedAt).toBeInstanceOf(Date);
  });

  it('clears intended reservations and rebinds runners when deleting a reservation by id', async () => {
    const [reservation, survivingReservation] = await db()
      .insert(reservations)
      .values([
        {
          workspaceId,
          provisionerId,
          requiredLabels: ['linux'],
          count: 1,
          expiresAt: new Date(Date.now() + 60_000),
        },
        {
          workspaceId: crypto.randomUUID(),
          provisionerId,
          requiredLabels: ['linux'],
          count: 1,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ])
      .returning();
    if (!reservation || !survivingReservation) throw new Error('Expected reservations');
    const runner = await createIdleRunner({
      labels: ['linux'],
      intendedReservationId: reservation.id,
    });
    const survivingRunner = await createIdleRunner({
      labels: ['linux'],
      intendedReservationId: survivingReservation.id,
    });

    const deleted = await deleteReservationsByIds([reservation.id]);

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    expect(deleted).toBe(1);
    expect(storedRunner).toMatchObject({
      intendedReservationId: null,
      workspaceId: null,
      reservationId: null,
      assignedAt: null,
      state: 'running',
      reservationReleasedAt: null,
    });
    const [storedSurvivingRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, survivingRunner.id));
    expect(storedSurvivingRunner?.intendedReservationId).toBe(survivingReservation.id);

    await createPendingJobs(1, ['linux']);
    await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });
    const [reboundRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    const reboundReservationId = reboundRunner?.reservationId;
    expect(reboundReservationId).toEqual(expect.any(String));
    expect(reboundRunner).toMatchObject({
      intendedReservationId: null,
      workspaceId,
      reservationId: reboundReservationId,
      assignedAt: expect.any(Date),
      state: 'running',
      reservationReleasedAt: null,
    });
  });

  it('clears intended reservations when deleting expired reservations', async () => {
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: ['linux'],
        count: 1,
        expiresAt: new Date(Date.now() - 60_000),
      })
      .returning();
    if (!reservation) throw new Error('Expected reservation');
    const runner = await createIdleRunner({
      labels: ['linux'],
      intendedReservationId: reservation.id,
    });

    const deleted = await deleteExpiredReservations();

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(storedRunner).toMatchObject({
      intendedReservationId: null,
      workspaceId: null,
      reservationId: null,
      assignedAt: null,
      state: 'running',
      reservationReleasedAt: null,
    });
  });

  it('decrements reservation units inside a caller transaction', async () => {
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count: 3,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [reservation] = await reservationsForTest();
    if (!reservation) throw new Error('Expected reservation');

    const released = await db().transaction((tx) =>
      releaseReservationUnits(tx, {
        workspaceId,
        provisionerId,
        releases: [{reservationId: reservation.id, count: 2}],
      }),
    );

    const rows = await reservationsForTest();
    expect(released).toBe(2);
    expect(rows[0]?.count).toBe(1);
  });

  it('deletes reservations when releasing all remaining units', async () => {
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [reservation] = await reservationsForTest();
    if (!reservation) throw new Error('Expected reservation');

    const released = await db().transaction((tx) =>
      releaseReservationUnits(tx, {
        workspaceId,
        provisionerId,
        releases: [{reservationId: reservation.id, count: 1}],
      }),
    );

    const rows = await reservationsForTest();
    expect(released).toBe(1);
    expect(rows).toHaveLength(0);
  });

  it('does not release another workspace or provisioner reservation', async () => {
    const otherWorkspace = await reservationFactory.create({
      workspaceId: crypto.randomUUID(),
      provisionerId,
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const otherProvisioner = await reservationFactory.create({
      workspaceId,
      provisionerId: crypto.randomUUID(),
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const rowsBefore = await db()
      .select()
      .from(reservations)
      .where(
        or(
          and(
            eq(reservations.workspaceId, otherWorkspace.workspaceId),
            eq(reservations.provisionerId, otherWorkspace.provisionerId),
          ),
          and(
            eq(reservations.workspaceId, otherProvisioner.workspaceId),
            eq(reservations.provisionerId, otherProvisioner.provisionerId),
          ),
        ),
      );

    const released = await db().transaction((tx) =>
      releaseReservationUnits(tx, {
        workspaceId,
        provisionerId,
        releases: rowsBefore.map((reservation) => ({reservationId: reservation.id, count: 1})),
      }),
    );

    const rowsAfter = await db()
      .select()
      .from(reservations)
      .where(
        inArray(
          reservations.id,
          rowsBefore.map((reservation) => reservation.id),
        ),
      );
    expect(released).toBe(0);
    expect(rowsAfter.map((reservation) => reservation.id).sort()).toEqual(
      rowsBefore.map((reservation) => reservation.id).sort(),
    );
  });

  it('credits only the deleted reservation count when release units exceed the row count', async () => {
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [reservation] = await reservationsForTest();
    if (!reservation) throw new Error('Expected reservation');

    const released = await db().transaction((tx) =>
      releaseReservationUnits(tx, {
        workspaceId,
        provisionerId,
        releases: [{reservationId: reservation.id, count: 3}],
      }),
    );

    const rows = await reservationsForTest();
    expect(released).toBe(1);
    expect(rows).toHaveLength(0);
  });

  async function createPendingJobs(count: number, requiredLabels: string[]): Promise<void> {
    for (let index = 0; index < count; index++) {
      await pendingJobFactory.create({workspaceId, requiredLabels});
    }
  }

  async function createIntendedReservation(params: {
    workspaceId: string;
    expiresAt: Date;
  }): Promise<{id: string}> {
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId: params.workspaceId,
        provisionerId,
        requiredLabels: ['linux'],
        count: 1,
        expiresAt: params.expiresAt,
      })
      .returning({id: reservations.id});
    if (!reservation) throw new Error('Expected reservation');
    return reservation;
  }

  async function createIdleRunner(params: {
    labels: string[];
    createdAt?: Date;
    controlSessionExpiresAt?: Date;
    launchKind?: 'demand' | 'warm' | 'manual';
    workspaceId?: string | null;
    reservationId?: string | null;
    intendedReservationId?: string | null;
    reservationReleasedAt?: Date | null;
  }) {
    const createdAt = params.createdAt ?? new Date();
    const [runner] = await db()
      .insert(providerRunners)
      .values({
        provisionerId,
        workspaceId: params.workspaceId,
        reservationId: params.reservationId,
        providerRunnerId: crypto.randomUUID(),
        launchKind: params.launchKind ?? 'manual',
        intendedReservationId: params.intendedReservationId,
        reservationReleasedAt: params.reservationReleasedAt,
        labels: params.labels,
        state: 'running',
        reportedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      })
      .returning();
    if (!runner) throw new Error('Expected runner instance');

    await db()
      .insert(runnerControlSessions)
      .values({
        runnerInstanceId: runner.id,
        provisionerId,
        hashedToken: crypto.randomUUID(),
        prefix: 'test',
        expiresAt: params.controlSessionExpiresAt ?? new Date(Date.now() + 60_000),
      });
    return runner;
  }

  async function activeReservedCount(): Promise<number> {
    const [row] = await db()
      .select({value: sum(reservations.count)})
      .from(reservations)
      .where(
        sql`${reservations.workspaceId} = ${workspaceId} and ${reservations.expiresAt} > now()`,
      );
    return Number(row?.value ?? 0);
  }

  async function reservationsForTest() {
    return await db()
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.workspaceId, workspaceId),
          eq(reservations.provisionerId, provisionerId),
        ),
      );
  }

  function template(templateKey: string, labels: string[], availableSlots: number) {
    return {templateKey, labels, availableSlots, starting: 0, running: 0};
  }
});
