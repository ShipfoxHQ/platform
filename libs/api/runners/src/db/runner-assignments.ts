import {and, eq, inArray, isNull, sql} from 'drizzle-orm';
import {
  ReservationExpiredError,
  ReservationNotFoundError,
  RunnerInstanceAlreadyAssignedError,
  RunnerInstanceNotAssignableError,
} from '#core/errors.js';
import {db} from './db.js';
import {reservations} from './schema/reservations.js';
import {runnerControlSessions} from './schema/runner-control-sessions.js';
import {providerRunners} from './schema/runner-instances.js';

/** Atomically consumes reservation units by writing the immutable assignment on each runner. */
export async function assignRunnerInstances(params: {
  provisionerId: string;
  reservationId: string;
  runnerInstanceIds: string[];
}): Promise<string[]> {
  const runnerInstanceIds = [...params.runnerInstanceIds].sort();
  return await db().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`runners_assignment:${params.provisionerId}:${params.reservationId}`}))`,
    );
    const runnerRows = await tx
      .select({
        id: providerRunners.id,
        reservationId: providerRunners.reservationId,
        workspaceId: providerRunners.workspaceId,
        providerRunnerId: providerRunners.providerRunnerId,
        labels: providerRunners.labels,
        state: providerRunners.state,
      })
      .from(providerRunners)
      .where(
        and(
          eq(providerRunners.provisionerId, params.provisionerId),
          inArray(providerRunners.id, runnerInstanceIds),
        ),
      )
      .for('update');

    // The assignment outlives its short reservation row. A retry after maintenance
    // cleanup is complete when every owned runner already carries the requested assignment.
    if (
      runnerInstanceIds.length > 0 &&
      runnerRows.length === runnerInstanceIds.length &&
      runnerRows.every((runner) => runner.reservationId === params.reservationId)
    )
      return params.runnerInstanceIds;

    const [reservation] = await tx
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.id, params.reservationId),
          eq(reservations.provisionerId, params.provisionerId),
        ),
      )
      .limit(1)
      .for('update');
    if (!reservation) throw new ReservationNotFoundError(params.reservationId);
    if (reservation.expiresAt <= new Date())
      throw new ReservationExpiredError(params.reservationId);
    if (runnerRows.length !== runnerInstanceIds.length)
      throw new RunnerInstanceNotAssignableError(runnerInstanceIds[0] ?? '');

    const activeControlSessions = await tx
      .select({runnerInstanceId: runnerControlSessions.runnerInstanceId})
      .from(runnerControlSessions)
      .where(
        and(
          inArray(
            runnerControlSessions.runnerInstanceId,
            runnerRows.map((runner) => runner.id),
          ),
          isNull(runnerControlSessions.closedAt),
        ),
      );
    const runnerInstanceIdsWithControlSession = new Set(
      activeControlSessions.map((session) => session.runnerInstanceId),
    );
    const runners = runnerRows.map((runner) => ({
      ...runner,
      controlSessionId: runnerInstanceIdsWithControlSession.has(runner.id) ? runner.id : null,
    }));

    const alreadyAssigned = runners.filter((runner) => runner.reservationId !== null);
    if (alreadyAssigned.some((runner) => runner.reservationId !== reservation.id))
      throw new RunnerInstanceAlreadyAssignedError(alreadyAssigned[0]?.id ?? '');
    const newRunners = runners.filter((runner) => runner.reservationId === null);
    const assignedCount = await tx
      .select({count: sql<number>`count(*)::int`})
      .from(providerRunners)
      .where(eq(providerRunners.reservationId, reservation.id));
    if ((assignedCount[0]?.count ?? 0) + newRunners.length > reservation.count)
      throw new RunnerInstanceNotAssignableError(newRunners[0]?.id ?? '');
    for (const runner of newRunners) {
      if (
        runner.state !== 'running' ||
        !runner.providerRunnerId ||
        !runner.controlSessionId ||
        !reservation.requiredLabels.every((label) => runner.labels.includes(label))
      )
        throw new RunnerInstanceNotAssignableError(runner.id);
    }
    if (newRunners.length > 0) {
      await tx
        .update(providerRunners)
        .set({
          workspaceId: reservation.workspaceId,
          reservationId: reservation.id,
          assignedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          inArray(
            providerRunners.id,
            newRunners.map((runner) => runner.id),
          ),
        );
    }
    return params.runnerInstanceIds;
  });
}
