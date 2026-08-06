import {and, eq, inArray, or, sql, sum} from 'drizzle-orm';
import {db} from '#db/db.js';
import {
  deleteExpiredReservations,
  deleteReservationsByIds,
  pollDemandAndReserve,
  pollInstallationDemandAndReserve,
  releaseReservationUnits,
} from '#db/reservations.js';
import {reservations} from '#db/schema/reservations.js';
import {runnerActivationTokens} from '#db/schema/runner-activation-tokens.js';
import {runnerControlSessions} from '#db/schema/runner-control-sessions.js';
import {providerRunners} from '#db/schema/runner-instances.js';
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

  it('binds the oldest matching enrolled runners to a new reservation', async () => {
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
    await createPendingJobs(2, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 2,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 2)],
    });

    const rows = await db()
      .select()
      .from(providerRunners)
      .where(inArray(providerRunners.id, [olderRunner.id, newerRunner.id, unmatchedRunner.id]));
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const reservationId = result.reservations[0]?.reservationId;

    expect(reservationId).toEqual(expect.any(String));
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

    expect(firstResult.reservations).toHaveLength(1);
    expect(secondResult.reservations).toEqual([]);
    expect(secondResult.stats[0]).toMatchObject({queued: 1, reserved: 1});
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

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });
    const reservationId = result.reservations[0]?.reservationId;
    if (!reservationId) throw new Error('Expected reservation');

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

  it('unbinds prewarmed runners and revokes activation tokens when deleting expired reservations', async () => {
    const runner = await createIdleRunner({labels: ['linux']});
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });
    const reservationId = result.reservations[0]?.reservationId;
    if (!reservationId) throw new Error('Expected reservation');

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
    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });
    const reboundReservationId = result.reservations[0]?.reservationId;
    const [reboundRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
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

  async function createIdleRunner(params: {
    labels: string[];
    createdAt?: Date;
    controlSessionExpiresAt?: Date;
    intendedReservationId?: string;
  }) {
    const createdAt = params.createdAt ?? new Date();
    const [runner] = await db()
      .insert(providerRunners)
      .values({
        provisionerId,
        providerRunnerId: crypto.randomUUID(),
        intendedReservationId: params.intendedReservationId,
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
