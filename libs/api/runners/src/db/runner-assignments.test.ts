import {eq} from 'drizzle-orm';
import {
  ReservationExpiredError,
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

  async function createReservation(
    overrides: Partial<{expiresAt: Date; requiredLabels: string[]}> = {},
  ) {
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: overrides.requiredLabels ?? ['linux'],
        count: 1,
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
