import {eq} from 'drizzle-orm';
import {
  ReservationExpiredError,
  ReservationNotFoundError,
  RunnerInstanceAlreadyAssignedError,
  RunnerInstanceNotAssignableError,
} from '#core/errors.js';
import {db} from '#db/db.js';
import {assignRunnerInstances} from '#db/runner-assignments.js';
import {reservations} from '#db/schema/reservations.js';
import {runnerControlSessions} from '#db/schema/runner-control-sessions.js';
import {providerRunners} from '#db/schema/runner-instances.js';

describe('assignRunnerInstances', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
  });

  it('writes the reservation and workspace after enrollment', async () => {
    const reservation = await createReservation();
    const runner = await createEnrolledRunner();

    const assigned = await assignRunnerInstances({
      provisionerId,
      reservationId: reservation.id,
      runnerInstanceIds: [runner.id],
    });

    expect(assigned).toEqual([runner.id]);
    const [stored] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    expect(stored).toMatchObject({
      workspaceId,
      reservationId: reservation.id,
      assignedAt: expect.any(Date),
    });
  });

  it('repairs a provider-reported reservation before assignment commit', async () => {
    const reservation = await createReservation();
    const [runner] = await db()
      .insert(providerRunners)
      .values({
        provisionerId,
        intendedReservationId: reservation.id,
        reservationId: reservation.id,
        providerRunnerId: crypto.randomUUID(),
        labels: ['linux'],
        state: 'running',
        reportedAt: new Date(),
      })
      .returning();
    if (!runner) throw new Error('Runner instance insert returned no row');
    await db()
      .insert(runnerControlSessions)
      .values({
        runnerInstanceId: runner.id,
        provisionerId,
        hashedToken: crypto.randomUUID(),
        prefix: 'test',
        expiresAt: new Date(Date.now() + 60_000),
      });

    const assigned = await assignRunnerInstances({
      provisionerId,
      reservationId: reservation.id,
      runnerInstanceIds: [runner.id],
    });

    expect(assigned).toEqual([runner.id]);
    const [stored] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    expect(stored).toMatchObject({
      workspaceId,
      reservationId: reservation.id,
      intendedReservationId: null,
      assignedAt: expect.any(Date),
    });
  });

  it('is idempotent for concurrent retries of the same assignment', async () => {
    const reservation = await createReservation();
    const runner = await createEnrolledRunner();

    const results = await Promise.all([
      assignRunnerInstances({
        provisionerId,
        reservationId: reservation.id,
        runnerInstanceIds: [runner.id],
      }),
      assignRunnerInstances({
        provisionerId,
        reservationId: reservation.id,
        runnerInstanceIds: [runner.id],
      }),
    ]);

    expect(results).toEqual([[runner.id], [runner.id]]);
  });

  it('is idempotent after an assigned reservation is deleted', async () => {
    const reservation = await createReservation();
    const runner = await createEnrolledRunner();
    await assignRunnerInstances({
      provisionerId,
      reservationId: reservation.id,
      runnerInstanceIds: [runner.id],
    });
    await db().delete(reservations).where(eq(reservations.id, reservation.id));

    const assigned = await assignRunnerInstances({
      provisionerId,
      reservationId: reservation.id,
      runnerInstanceIds: [runner.id],
    });

    expect(assigned).toEqual([runner.id]);
  });

  it('is idempotent for a committed bound reservation assignment', async () => {
    const reservation = await createReservation({kind: 'bound'});
    const runner = await createEnrolledRunner();
    await db()
      .update(providerRunners)
      .set({
        workspaceId,
        reservationId: reservation.id,
        assignedAt: new Date(),
      })
      .where(eq(providerRunners.id, runner.id));

    const assigned = await assignRunnerInstances({
      provisionerId,
      reservationId: reservation.id,
      runnerInstanceIds: [runner.id],
    });

    expect(assigned).toEqual([runner.id]);
    const [stored] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    expect(stored?.intendedReservationId).toBeNull();
  });

  it('rejects expired reservations', async () => {
    const reservation = await createReservation({expiresAt: new Date(Date.now() - 1_000)});
    const runner = await createEnrolledRunner();

    const assignment = assignRunnerInstances({
      provisionerId,
      reservationId: reservation.id,
      runnerInstanceIds: [runner.id],
    });

    await expect(assignment).rejects.toThrow(ReservationExpiredError);
  });

  it('rejects bound reservations', async () => {
    const reservation = await createReservation({kind: 'bound'});
    const runner = await createEnrolledRunner();

    const assignment = assignRunnerInstances({
      provisionerId,
      reservationId: reservation.id,
      runnerInstanceIds: [runner.id],
    });

    await expect(assignment).rejects.toThrow(ReservationNotFoundError);
  });

  it('rejects unenrolled or incompatible runners', async () => {
    const reservation = await createReservation({requiredLabels: ['linux', 'gpu']});
    const runner = await createEnrolledRunner({labels: ['linux']});

    const assignment = assignRunnerInstances({
      provisionerId,
      reservationId: reservation.id,
      runnerInstanceIds: [runner.id],
    });

    await expect(assignment).rejects.toThrow(RunnerInstanceNotAssignableError);
  });

  it('rejects a runner assigned to a different reservation', async () => {
    const firstReservation = await createReservation();
    const secondReservation = await createReservation();
    const runner = await createEnrolledRunner();
    await assignRunnerInstances({
      provisionerId,
      reservationId: firstReservation.id,
      runnerInstanceIds: [runner.id],
    });

    const assignment = assignRunnerInstances({
      provisionerId,
      reservationId: secondReservation.id,
      runnerInstanceIds: [runner.id],
    });

    await expect(assignment).rejects.toThrow(RunnerInstanceAlreadyAssignedError);
  });

  it('rejects assignments that exceed reservation capacity', async () => {
    const reservation = await createReservation();
    const firstRunner = await createEnrolledRunner();
    const secondRunner = await createEnrolledRunner();

    const assignment = assignRunnerInstances({
      provisionerId,
      reservationId: reservation.id,
      runnerInstanceIds: [firstRunner.id, secondRunner.id],
    });

    await expect(assignment).rejects.toThrow(RunnerInstanceNotAssignableError);
  });

  it('charges capacity for a committed runner replayed alongside a new one', async () => {
    const reservation = await createReservation();
    const firstRunner = await createEnrolledRunner();
    const secondRunner = await createEnrolledRunner();
    await assignRunnerInstances({
      provisionerId,
      reservationId: reservation.id,
      runnerInstanceIds: [firstRunner.id],
    });

    const assignment = assignRunnerInstances({
      provisionerId,
      reservationId: reservation.id,
      runnerInstanceIds: [firstRunner.id, secondRunner.id],
    });

    await expect(assignment).rejects.toThrow(RunnerInstanceNotAssignableError);
  });

  it('does not charge capacity for an already released reservation intent', async () => {
    const reservation = await createReservation();
    await db().insert(providerRunners).values({
      provisionerId,
      intendedReservationId: reservation.id,
      reservationReleasedAt: new Date(),
      providerRunnerId: crypto.randomUUID(),
      state: 'failed',
      reportedAt: new Date(),
    });
    const runner = await createEnrolledRunner();

    await expect(
      assignRunnerInstances({
        provisionerId,
        reservationId: reservation.id,
        runnerInstanceIds: [runner.id],
      }),
    ).resolves.toEqual([runner.id]);
  });

  it('does not charge capacity for an already released reservation assignment', async () => {
    const reservation = await createReservation();
    await db().insert(providerRunners).values({
      provisionerId,
      reservationId: reservation.id,
      reservationReleasedAt: new Date(),
      providerRunnerId: crypto.randomUUID(),
      state: 'failed',
      reportedAt: new Date(),
    });
    const runner = await createEnrolledRunner();

    await expect(
      assignRunnerInstances({
        provisionerId,
        reservationId: reservation.id,
        runnerInstanceIds: [runner.id],
      }),
    ).resolves.toEqual([runner.id]);
  });

  it('does not charge capacity for a terminal reservation intent before release bookkeeping', async () => {
    const reservation = await createReservation();
    await db().insert(providerRunners).values({
      provisionerId,
      intendedReservationId: reservation.id,
      providerRunnerId: crypto.randomUUID(),
      state: 'failed',
      reportedAt: new Date(),
    });
    const runner = await createEnrolledRunner();

    await expect(
      assignRunnerInstances({
        provisionerId,
        reservationId: reservation.id,
        runnerInstanceIds: [runner.id],
      }),
    ).resolves.toEqual([runner.id]);
  });

  it('does not charge capacity for a terminal reservation assignment before release bookkeeping', async () => {
    const reservation = await createReservation();
    await db().insert(providerRunners).values({
      provisionerId,
      reservationId: reservation.id,
      providerRunnerId: crypto.randomUUID(),
      state: 'failed',
      reportedAt: new Date(),
    });
    const runner = await createEnrolledRunner();

    await expect(
      assignRunnerInstances({
        provisionerId,
        reservationId: reservation.id,
        runnerInstanceIds: [runner.id],
      }),
    ).resolves.toEqual([runner.id]);
  });

  async function createReservation(
    overrides: Partial<{expiresAt: Date; requiredLabels: string[]; kind: 'bound' | 'launch'}> = {},
  ) {
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: overrides.requiredLabels ?? ['linux'],
        count: 1,
        kind: overrides.kind ?? 'launch',
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
      })
      .returning();
    if (!reservation) throw new Error('Reservation insert returned no row');
    return reservation;
  }

  async function createEnrolledRunner(overrides: Partial<{labels: string[]}> = {}) {
    const [runner] = await db()
      .insert(providerRunners)
      .values({
        provisionerId,
        providerRunnerId: crypto.randomUUID(),
        labels: overrides.labels ?? ['linux'],
        state: 'running',
        reportedAt: new Date(),
      })
      .returning();
    if (!runner) throw new Error('Runner instance insert returned no row');
    await db()
      .insert(runnerControlSessions)
      .values({
        runnerInstanceId: runner.id,
        provisionerId,
        hashedToken: crypto.randomUUID(),
        prefix: 'test',
        expiresAt: new Date(Date.now() + 60_000),
      });
    return runner;
  }
});
