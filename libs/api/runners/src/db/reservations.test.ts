import {pgClient} from '@shipfox/node-postgres';
import {vi} from '@shipfox/vitest/vi';
import {and, eq, inArray, or, sql, sum} from 'drizzle-orm';
import type {RunnerInstanceState} from '#core/entities/runner-instance.js';
import {db} from '#db/db.js';
import {
  countLiveReservationLeakUnits,
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

  it('does not mask demand with a claimed reservation unit', async () => {
    const reservation = await createIntendedReservation({
      workspaceId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await createIdleRunner({
      labels: ['linux'],
      workspaceId,
      reservationId: reservation.id,
      firstClaimedAt: new Date(),
      controlSessionExpiresAt: new Date(Date.now() - 1_000),
    });
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    expect(result.reservations).toEqual([expect.objectContaining({labels: ['linux'], count: 1})]);
    expect(result.stats[0]).toMatchObject({queued: 1, reserved: 1});
  });

  it('masks exactly one unit for a booting unclaimed runner', async () => {
    const reservation = await createIntendedReservation({
      workspaceId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await createIdleRunner({
      labels: ['linux'],
      reservationId: reservation.id,
      firstClaimedAt: null,
    });
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    expect(result.reservations).toEqual([]);
    expect(result.stats[0]).toMatchObject({queued: 1, reserved: 1});
  });

  it('does not mask demand when a granted unit has no live unclaimed runner', async () => {
    await createIntendedReservation({
      workspaceId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    expect(result.reservations).toEqual([expect.objectContaining({labels: ['linux'], count: 1})]);
    expect(result.stats[0]).toMatchObject({queued: 1, reserved: 1});
  });

  it('does not block on reservation locks while observing leaked units', async () => {
    const leakedUnitsBefore = await countLiveReservationLeakUnits();
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: ['linux'],
        count: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning({id: reservations.id});
    if (!reservation) throw new Error('Expected reservation');
    const lockClient = await pgClient().connect();
    let transactionOpen = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await lockClient.query('BEGIN');
      transactionOpen = true;
      await lockClient.query('SELECT id FROM runners_reservations WHERE id = $1 FOR UPDATE', [
        reservation.id,
      ]);
      await lockClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `runners_assignment:${provisionerId}:${reservation.id}`,
      ]);

      const leakedUnits = await Promise.race([
        countLiveReservationLeakUnits(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Leak gauge waited on reservation mutation locks')),
            1_000,
          );
        }),
      ]);

      expect(leakedUnits).toBe(leakedUnitsBefore + 1);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (transactionOpen) await lockClient.query('ROLLBACK');
      lockClient.release();
    }
  }, 10_000);

  it('does not create a bound reservation when no idle runner can be rebound', async () => {
    await createPendingJobs(1, ['linux']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux', ['linux'], 1)],
    });

    const storedReservations = await reservationsForTest();
    expect(result.reservations).toHaveLength(1);
    expect(storedReservations).toHaveLength(1);
    expect(storedReservations[0]).toMatchObject({kind: 'launch', count: 1});
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

  it('does not deadlock polling with expired-reservation cleanup', async () => {
    const oldestRunnerId = `ffffffff-${crypto.randomUUID().slice(9)}`;
    const lowestIdRunnerId = `00000000-${crypto.randomUUID().slice(9)}`;
    const [expiredReservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: ['linux'],
        count: 2,
        expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      })
      .returning({id: reservations.id});
    if (!expiredReservation) throw new Error('Expected expired reservation');

    const oldestRunner = await createIdleRunner({
      id: oldestRunnerId,
      labels: ['linux'],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      workspaceId,
      reservationId: expiredReservation.id,
    });
    const lowestIdRunner = await createIdleRunner({
      id: lowestIdRunnerId,
      labels: ['linux'],
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      workspaceId,
      reservationId: expiredReservation.id,
    });
    await createPendingJobs(2, ['linux']);

    const lockClient = await pgClient().connect();
    let transactionOpen = false;
    let cleanupPromise: Promise<number> | undefined;
    let pollPromise: ReturnType<typeof pollDemandAndReserve> | undefined;
    try {
      await lockClient.query('BEGIN');
      transactionOpen = true;
      const lockPidResult = await lockClient.query<{pid: number}>('SELECT pg_backend_pid() AS pid');
      const lockPid = lockPidResult.rows[0]?.pid;
      if (lockPid === undefined) throw new Error('Expected lock holder backend pid');
      await lockClient.query('SELECT id FROM runners_runner_instances WHERE id = $1 FOR UPDATE', [
        lowestIdRunner.id,
      ]);

      cleanupPromise = deleteExpiredReservations({limit: 1});
      // Attach a handler before waiting for the second transaction so a deadlock loser cannot
      // become an unhandled rejection while the test is coordinating the lock holders.
      cleanupPromise.catch(() => undefined);
      await waitForLockWait({blockingPid: lockPid});

      pollPromise = pollDemandAndReserve({
        workspaceId,
        provisionerId,
        maxReservations: 2,
        ttlSeconds: 60,
        templates: [template('linux', ['linux'], 2)],
      });
      pollPromise.catch(() => undefined);
      await waitForLockWait({blockingPid: lockPid, minWaiters: 2});

      await lockClient.query('COMMIT');
      transactionOpen = false;

      if (!cleanupPromise || !pollPromise) throw new Error('Expected concurrent operations');
      const [deleted, result] = await Promise.all([cleanupPromise, pollPromise]);

      expect(deleted).toBe(1);
      expect(result.reservations).toEqual([]);
      const rows = await db()
        .select({id: providerRunners.id, reservationId: providerRunners.reservationId})
        .from(providerRunners)
        .where(inArray(providerRunners.id, [oldestRunner.id, lowestIdRunner.id]));
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.reservationId !== expiredReservation.id)).toBe(true);
    } finally {
      if (transactionOpen) await lockClient.query('ROLLBACK');
      if (cleanupPromise) await cleanupPromise.catch(() => undefined);
      if (pollPromise) await pollPromise.catch(() => undefined);
      lockClient.release();
    }
  }, 10_000);

  it('refills with the next eligible runner when the oldest becomes ineligible', async () => {
    const runner = await createIdleRunner({
      labels: ['linux'],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const replacementRunner = await createIdleRunner({
      labels: ['linux'],
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    await createPendingJobs(1, ['linux']);

    const lockClient = await pgClient().connect();
    const eligibilityClient = await pgClient().connect();
    let lockTransactionOpen = false;
    let eligibilityTransactionOpen = false;
    let eligibilityLockPromise: Promise<unknown> | undefined;
    let pollPromise: ReturnType<typeof pollDemandAndReserve> | undefined;
    try {
      await lockClient.query('BEGIN');
      lockTransactionOpen = true;
      const lockPidResult = await lockClient.query<{pid: number}>('SELECT pg_backend_pid() AS pid');
      const lockPid = lockPidResult.rows[0]?.pid;
      if (lockPid === undefined) throw new Error('Expected lock holder backend pid');
      await lockClient.query('SELECT id FROM runners_runner_instances WHERE id = $1 FOR UPDATE', [
        runner.id,
      ]);

      await eligibilityClient.query('BEGIN');
      eligibilityTransactionOpen = true;
      const eligibilityPidResult = await eligibilityClient.query<{pid: number}>(
        'SELECT pg_backend_pid() AS pid',
      );
      const eligibilityPid = eligibilityPidResult.rows[0]?.pid;
      if (eligibilityPid === undefined) throw new Error('Expected eligibility backend pid');
      eligibilityLockPromise = eligibilityClient.query(
        'SELECT id FROM runners_runner_instances WHERE id = $1 FOR UPDATE',
        [runner.id],
      );
      // Attach a handler before starting the poll so cleanup can safely await a failed lock query.
      eligibilityLockPromise.catch(() => undefined);
      await waitForLockWait({blockingPid: lockPid});

      pollPromise = pollDemandAndReserve({
        workspaceId,
        provisionerId,
        maxReservations: 1,
        ttlSeconds: 60,
        templates: [template('linux', ['linux'], 1)],
      });
      pollPromise.catch(() => undefined);
      await waitForLockWait({blockingPid: eligibilityPid});

      await lockClient.query('COMMIT');
      lockTransactionOpen = false;
      await eligibilityLockPromise;
      await eligibilityClient.query(
        "UPDATE runners_runner_instances SET state = 'terminated', terminated_at = now(), updated_at = now() WHERE id = $1",
        [runner.id],
      );
      await eligibilityClient.query(
        "UPDATE runners_runner_control_sessions SET closed_at = now(), close_reason = 'test' WHERE runner_instance_id = $1 AND closed_at IS NULL",
        [runner.id],
      );
      await eligibilityClient.query('COMMIT');
      eligibilityTransactionOpen = false;

      if (!pollPromise) throw new Error('Expected concurrent poll');
      const result = await pollPromise;

      expect(result.reservations).toEqual([]);
      const rows = await db()
        .select({
          id: providerRunners.id,
          state: providerRunners.state,
          workspaceId: providerRunners.workspaceId,
          reservationId: providerRunners.reservationId,
        })
        .from(providerRunners)
        .where(inArray(providerRunners.id, [runner.id, replacementRunner.id]));
      const rowsById = new Map(rows.map((row) => [row.id, row]));
      expect(rowsById.get(runner.id)).toMatchObject({
        state: 'terminated',
        workspaceId: null,
        reservationId: null,
      });
      expect(rowsById.get(replacementRunner.id)).toMatchObject({
        state: 'running',
        workspaceId,
        reservationId: expect.any(String),
      });
    } finally {
      if (lockTransactionOpen) await lockClient.query('ROLLBACK');
      if (eligibilityTransactionOpen) await eligibilityClient.query('ROLLBACK');
      if (eligibilityLockPromise) await eligibilityLockPromise.catch(() => undefined);
      if (pollPromise) await pollPromise.catch(() => undefined);
      lockClient.release();
      eligibilityClient.release();
    }
  }, 10_000);

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

  it('keeps a booting adopted runner in later overlapping demand accounting', async () => {
    const adoptedRunner = await createIdleRunner({labels: ['linux', 'gpu']});
    await createPendingJobs(1, ['linux', 'gpu']);

    const firstPoll = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux-gpu', ['linux', 'gpu'], 1)],
    });
    expect(firstPoll.reservations).toEqual([]);

    await createPendingJobs(1, ['linux']);
    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux-gpu', ['linux', 'gpu'], 1)],
    });

    const storedReservations = await reservationsForTest();
    const boundReservation = storedReservations.find(
      (reservation) => reservation.requiredLabels.includes('gpu') && reservation.kind === 'bound',
    );
    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, adoptedRunner.id));

    expect(result.reservations).toEqual([]);
    expect(boundReservation).toMatchObject({kind: 'bound', count: 1});
    expect(storedRunner?.reservationId).toBe(boundReservation?.id);
  });

  it('deducts all booting units from a partially adopted reservation', async () => {
    await createIdleRunner({labels: ['linux', 'gpu']});
    await createIdleRunner({labels: ['linux', 'gpu']});
    await createPendingJobs(3, ['linux', 'gpu']);

    const firstPoll = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 3,
      ttlSeconds: 60,
      templates: [template('linux-gpu', ['linux', 'gpu'], 3)],
    });
    expect(firstPoll.reservations).toEqual([expect.objectContaining({count: 1})]);

    await createPendingJobs(1, ['linux']);
    const secondPoll = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux-gpu', ['linux', 'gpu'], 2)],
    });

    expect(secondPoll.reservations).toEqual([]);
  });

  it('does not let a launch reservation with no live runner mask demand', async () => {
    await createPendingJobs(1, ['linux', 'gpu']);

    const firstPoll = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux-gpu', ['linux', 'gpu'], 1)],
    });
    expect(firstPoll.reservations).toEqual([expect.objectContaining({count: 1})]);

    await createPendingJobs(1, ['linux']);
    const secondPoll = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux-gpu', ['linux', 'gpu'], 1)],
    });

    expect(secondPoll.reservations).toEqual([
      expect.objectContaining({labels: ['gpu', 'linux'], count: 1}),
    ]);
  });

  it('keeps an intended runner while its reservation assignment is in flight in accounting', async () => {
    const intendedReservation = await createIntendedReservation({
      workspaceId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await createIdleRunner({
      labels: ['linux', 'gpu'],
      intendedReservationId: intendedReservation.id,
    });
    await createPendingJobs(1, ['linux', 'gpu']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux-gpu', ['linux', 'gpu'], 1)],
    });

    expect(result.reservations).toEqual([]);
  });

  it('does not deduct a released runner reservation unit from capacity', async () => {
    const reservation = await createIntendedReservation({
      workspaceId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await createIdleRunner({
      labels: ['linux'],
      reservationId: reservation.id,
      reservationReleasedAt: new Date(Date.now() - 1_000),
    });
    await createPendingJobs(1, ['linux', 'gpu']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux-gpu', ['linux', 'gpu'], 1)],
    });

    expect(result.reservations).toEqual([
      expect.objectContaining({labels: ['gpu', 'linux'], count: 1}),
    ]);
  });

  it('does not deduct a terminal intended runner reservation unit from capacity', async () => {
    const reservation = await createIntendedReservation({
      workspaceId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await createIdleRunner({
      labels: ['linux'],
      intendedReservationId: reservation.id,
      state: 'terminated',
    });
    await createPendingJobs(1, ['linux', 'gpu']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux-gpu', ['linux', 'gpu'], 1)],
    });

    expect(result.reservations).toEqual([
      expect.objectContaining({labels: ['gpu', 'linux'], count: 1}),
    ]);
  });

  it('does not deduct a terminal assigned runner reservation unit from capacity', async () => {
    const reservation = await createIntendedReservation({
      workspaceId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await createIdleRunner({
      labels: ['linux'],
      reservationId: reservation.id,
      state: 'terminated',
    });
    await createPendingJobs(1, ['linux', 'gpu']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [template('linux-gpu', ['linux', 'gpu'], 1)],
    });

    expect(result.reservations).toEqual([
      expect.objectContaining({labels: ['gpu', 'linux'], count: 1}),
    ]);
  });

  it('counts only active assigned runners when deducting provisioner reservations', async () => {
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: ['linux'],
        count: 2,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning({id: reservations.id});
    if (!reservation) throw new Error('Expected reservation');
    await createIdleRunner({
      labels: ['linux'],
      reservationId: reservation.id,
      state: 'running',
    });
    await createIdleRunner({
      labels: ['linux'],
      reservationId: reservation.id,
      state: 'failed',
    });
    await createPendingJobs(2, ['linux', 'gpu']);

    const result = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 2,
      ttlSeconds: 60,
      templates: [template('linux-gpu', ['linux', 'gpu'], 2)],
    });

    expect(result.reservations).toHaveLength(1);
    expect(result.reservations[0]?.count).toBe(1);
    expect(result.stats[0]).toMatchObject({queued: 2, reserved: 1});
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

  it('does not rebind a runner reserved by a concurrent installation poll', async () => {
    const previousWorkspaceId = crypto.randomUUID();
    const targetWorkspaceId = crypto.randomUUID();
    const runner = await createIdleRunner({labels: ['linux']});
    await pendingJobFactory.create({workspaceId: targetWorkspaceId, requiredLabels: ['linux']});

    const lockClient = await pgClient().connect();
    let transactionOpen = false;
    let pollPromise: ReturnType<typeof pollInstallationDemandAndReserve> | undefined;
    try {
      await lockClient.query('BEGIN');
      transactionOpen = true;
      const lockPidResult = await lockClient.query<{pid: number}>('SELECT pg_backend_pid() AS pid');
      const lockPid = lockPidResult.rows[0]?.pid;
      if (lockPid === undefined) throw new Error('Expected lock holder backend pid');
      await lockClient.query('SELECT id FROM runners_runner_instances WHERE id = $1 FOR UPDATE', [
        runner.id,
      ]);

      const reservationId = crypto.randomUUID();
      await lockClient.query(
        `INSERT INTO runners_reservations
          (id, workspace_id, provisioner_id, required_labels, count, kind, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'bound', $6)`,
        [
          reservationId,
          previousWorkspaceId,
          provisionerId,
          ['linux'],
          1,
          new Date(Date.now() + 60_000),
        ],
      );
      await lockClient.query(
        `UPDATE runners_runner_instances
         SET workspace_id = $1, reservation_id = $2, updated_at = now()
         WHERE id = $3`,
        [previousWorkspaceId, reservationId, runner.id],
      );

      pollPromise = pollInstallationDemandAndReserve({
        provisionerId,
        maxReservations: 1,
        ttlSeconds: 60,
        templates: [template('linux', ['linux'], 1)],
        capabilityWindowSeconds: 60,
        eligibleWorkspaceIds: new Set([targetWorkspaceId]),
      });
      // waitForLockWait yields to the macrotask queue, so an early poll rejection would
      // surface as an unhandled rejection before the finally block attaches its handler.
      pollPromise.catch(() => undefined);
      await waitForLockWait({blockingPid: lockPid});

      await lockClient.query('COMMIT');
      transactionOpen = false;
      const result = await pollPromise;
      const [storedRunner] = await db()
        .select()
        .from(providerRunners)
        .where(eq(providerRunners.id, runner.id));
      const storedReservations = await db()
        .select()
        .from(reservations)
        .where(eq(reservations.provisionerId, provisionerId));

      expect(result.reservations).toHaveLength(1);
      expect(result.reservations[0]).toMatchObject({workspaceId: targetWorkspaceId, count: 1});
      expect(storedRunner).toMatchObject({
        workspaceId: previousWorkspaceId,
        reservationId,
      });
      expect(storedReservations).toHaveLength(2);
      expect(
        storedReservations.find((reservation) => reservation.workspaceId === targetWorkspaceId),
      ).toMatchObject({kind: 'launch', count: 1});
    } finally {
      if (transactionOpen) await lockClient.query('ROLLBACK');
      if (pollPromise) await pollPromise.catch(() => undefined);
      lockClient.release();
    }
  });

  it.each([
    ['template capacity', 5, 2, 2],
    ['global reservation budget', 2, 5, 1],
  ])('does not overcount rebound units for the %s case', async (_case, maxReservations, availableSlots, expectedLaunchCount) => {
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
      expect.objectContaining({workspaceId: launchWorkspaceId, count: expectedLaunchCount}),
    ]);
    expect(storedReservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({workspaceId: reboundWorkspaceId, kind: 'bound', count: 1}),
        expect.objectContaining({
          workspaceId: launchWorkspaceId,
          kind: 'launch',
          count: expectedLaunchCount,
        }),
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

  it('applies existing booting reservations across multiple provisioners', async () => {
    const reservedProvisionerId = crypto.randomUUID();
    const [reservedReservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId: reservedProvisionerId,
        requiredLabels: ['linux'],
        count: 5,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning({id: reservations.id});
    if (!reservedReservation) throw new Error('Expected reservation');
    for (let index = 0; index < 5; index++) {
      await createIdleRunner({
        provisionerId: reservedProvisionerId,
        labels: ['linux'],
        reservationId: reservedReservation.id,
      });
    }
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
    expect(reserved).toBe(5);
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

  it('does not mask demand with spent reservations from this provisioner', async () => {
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
    expect(result.reservations).toEqual([expect.objectContaining({labels: ['linux'], count: 5})]);
    expect(result.stats[0]).toMatchObject({queued: 10, reserved: 5});
    expect(reserved).toBe(10);
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

  it('releases units from multiple reservations in one transaction', async () => {
    const [first] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: ['linux'],
        count: 3,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning({id: reservations.id});
    const [second] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: ['linux', 'gpu'],
        count: 2,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning({id: reservations.id});
    if (!first || !second) throw new Error('Expected reservations');

    const released = await db().transaction((tx) =>
      releaseReservationUnits(tx, {
        workspaceId,
        provisionerId,
        releases: [
          {reservationId: first.id, count: 2},
          {reservationId: second.id, count: 1},
        ],
      }),
    );

    const rows = await reservationsForTest();
    expect(released).toBe(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({id: first.id, count: 1}),
        expect.objectContaining({id: second.id, count: 1}),
      ]),
    );
  });

  it('does not strand units when concurrent releases drain one reservation', async () => {
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: ['linux'],
        count: 2,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning({id: reservations.id});
    if (!reservation) throw new Error('Expected reservation');

    const [firstReleased, secondReleased] = await Promise.all([
      db().transaction((tx) =>
        releaseReservationUnits(tx, {
          workspaceId,
          provisionerId,
          releases: [{reservationId: reservation.id, count: 1}],
        }),
      ),
      db().transaction((tx) =>
        releaseReservationUnits(tx, {
          workspaceId,
          provisionerId,
          releases: [{reservationId: reservation.id, count: 1}],
        }),
      ),
    ]);

    expect(firstReleased + secondReleased).toBe(2);
    expect(await reservationsForTest()).toHaveLength(0);
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
    id?: string;
    provisionerId?: string;
    labels: string[];
    createdAt?: Date;
    controlSessionExpiresAt?: Date;
    launchKind?: 'demand' | 'warm' | 'manual';
    workspaceId?: string | null;
    reservationId?: string | null;
    intendedReservationId?: string | null;
    reservationReleasedAt?: Date | null;
    firstClaimedAt?: Date | null;
    state?: RunnerInstanceState;
  }) {
    const createdAt = params.createdAt ?? new Date();
    const runnerProvisionerId = params.provisionerId ?? provisionerId;
    const [runner] = await db()
      .insert(providerRunners)
      .values({
        ...(params.id ? {id: params.id} : {}),
        provisionerId: runnerProvisionerId,
        workspaceId: params.workspaceId,
        reservationId: params.reservationId,
        providerRunnerId: crypto.randomUUID(),
        launchKind: params.launchKind ?? 'manual',
        intendedReservationId: params.intendedReservationId,
        reservationReleasedAt: params.reservationReleasedAt,
        firstClaimedAt: params.firstClaimedAt,
        labels: params.labels,
        state: params.state ?? 'running',
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
        provisionerId: runnerProvisionerId,
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

async function waitForLockWait(params: {blockingPid: number; minWaiters?: number}) {
  const minWaiters = params.minWaiters ?? 1;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pgClient().query<{count: number}>(
      `
        WITH RECURSIVE lock_waiters(waiter_pid, blocker_pid, path) AS (
          SELECT activity.pid, blockers.blocker_pid, ARRAY[activity.pid, blockers.blocker_pid]
          FROM pg_stat_activity AS activity
          CROSS JOIN LATERAL unnest(pg_blocking_pids(activity.pid)) AS blockers(blocker_pid)
          WHERE activity.datname = current_database()
            AND activity.pid <> pg_backend_pid()
            AND activity.state = 'active'
            AND activity.wait_event_type = 'Lock'
          UNION ALL
          SELECT waiters.waiter_pid, blockers.blocker_pid, waiters.path || blockers.blocker_pid
          FROM lock_waiters AS waiters
          CROSS JOIN LATERAL unnest(pg_blocking_pids(waiters.blocker_pid)) AS blockers(blocker_pid)
          WHERE NOT (blockers.blocker_pid = ANY(waiters.path))
        )
        SELECT count(DISTINCT waiter_pid)::int AS count
        FROM lock_waiters
        WHERE blocker_pid = $1::int
      `,
      [params.blockingPid],
    );
    if ((result.rows[0]?.count ?? 0) >= minWaiters) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out waiting for ${minWaiters} backend(s) blocked by pid ${params.blockingPid}`,
  );
}
