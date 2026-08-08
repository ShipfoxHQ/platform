import {and, eq, inArray, isNull, ne, notInArray, or, sql} from 'drizzle-orm';
import {
  ReservationExpiredError,
  ReservationNotFoundError,
  RunnerInstanceAlreadyAssignedError,
  RunnerInstanceNotAssignableError,
} from '#core/errors.js';
import {
  type RunnerAssignmentSurface,
  recordProviderRunnerControlSessionToAssignment,
} from '#metrics/instance.js';
import type {Tx} from './db.js';
import {db} from './db.js';
import {lockRunnerReservationAdvisoryKeysTx} from './reservation-locks.js';
import {terminalStates} from './runner-states.js';
import {reservations} from './schema/reservations.js';
import {runnerControlSessions} from './schema/runner-control-sessions.js';
import {providerRunners} from './schema/runner-instances.js';

/** Atomically consumes reservation units by writing the immutable assignment on each runner. */
export async function assignRunnerInstances(params: {
  provisionerId: string;
  reservationId: string;
  runnerInstanceIds: string[];
}): Promise<string[]> {
  return await db().transaction(async (tx) =>
    assignRunnerInstancesTx(tx, {...params, surface: 'provisioner'}),
  );
}

export async function assignRunnerInstancesTx(
  tx: Tx,
  params: {
    provisionerId: string;
    reservationId: string;
    runnerInstanceIds: string[];
    surface?: RunnerAssignmentSurface;
  },
): Promise<string[]> {
  const surface = params.surface ?? 'provisioner';
  const runnerInstanceIds = [...params.runnerInstanceIds].sort();
  await lockRunnerReservationAdvisoryKeysTx(tx, {
    provisionerId: params.provisionerId,
    reservationIds: [params.reservationId],
  });
  const runnerRows = await tx
    .select({
      id: providerRunners.id,
      reservationId: providerRunners.reservationId,
      intendedReservationId: providerRunners.intendedReservationId,
      workspaceId: providerRunners.workspaceId,
      assignedAt: providerRunners.assignedAt,
      providerRunnerId: providerRunners.providerRunnerId,
      provider: providerRunners.providerKind,
      launchKind: providerRunners.launchKind,
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
  // cleanup is complete when every owned runner already carries the committed assignment.
  if (
    runnerInstanceIds.length > 0 &&
    runnerRows.length === runnerInstanceIds.length &&
    runnerRows.every(
      (runner) =>
        runner.reservationId === params.reservationId &&
        runner.assignedAt !== null &&
        runner.workspaceId !== null,
    )
  ) {
    await tx
      .update(providerRunners)
      .set({intendedReservationId: null, updatedAt: sql`now()`})
      .where(
        and(
          eq(providerRunners.provisionerId, params.provisionerId),
          inArray(providerRunners.id, runnerInstanceIds),
        ),
      );
    return params.runnerInstanceIds;
  }

  const [reservation] = await tx
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.id, params.reservationId),
        eq(reservations.provisionerId, params.provisionerId),
        eq(reservations.kind, 'launch'),
      ),
    )
    .limit(1)
    .for('update');
  if (!reservation) throw new ReservationNotFoundError(params.reservationId);
  if (reservation.expiresAt <= new Date()) throw new ReservationExpiredError(params.reservationId);
  if (runnerRows.length !== runnerInstanceIds.length)
    throw new RunnerInstanceNotAssignableError(runnerInstanceIds[0] ?? '', 'runner-not-found');

  const activeControlSessions = await tx
    .select({
      runnerInstanceId: runnerControlSessions.runnerInstanceId,
      createdAt: runnerControlSessions.createdAt,
    })
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
  const controlSessionCreatedAtByRunner = new Map(
    activeControlSessions.map((session) => [session.runnerInstanceId, session.createdAt]),
  );
  const runners = runnerRows.map((runner) => ({
    ...runner,
    controlSessionId: runnerInstanceIdsWithControlSession.has(runner.id) ? runner.id : null,
    controlSessionCreatedAt: controlSessionCreatedAtByRunner.get(runner.id) ?? null,
  }));

  const alreadyAssigned = runners.filter((runner) => runner.reservationId !== null);
  if (alreadyAssigned.some((runner) => runner.reservationId !== reservation.id))
    throw new RunnerInstanceAlreadyAssignedError(alreadyAssigned[0]?.id ?? '');
  const newRunners = runners.filter(
    (runner) =>
      runner.reservationId === null ||
      (runner.reservationId === reservation.id &&
        (runner.assignedAt === null || runner.workspaceId === null)),
  );
  const newRunnerIds = newRunners.map((runner) => runner.id);
  const assignedCount = await tx
    .select({count: sql<number>`count(*)::int`})
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.provisionerId, params.provisionerId),
        notInArray(providerRunners.id, newRunnerIds),
        or(
          and(
            eq(providerRunners.reservationId, reservation.id),
            isNull(providerRunners.reservationReleasedAt),
          ),
          and(
            eq(providerRunners.intendedReservationId, reservation.id),
            isNull(providerRunners.reservationReleasedAt),
            notInArray(providerRunners.state, [...terminalStates]),
          ),
        ),
      ),
    );
  if ((assignedCount[0]?.count ?? 0) + newRunners.length > reservation.count)
    throw new RunnerInstanceNotAssignableError(newRunners[0]?.id ?? '', 'capacity-exhausted');
  for (const runner of newRunners) {
    if (runner.state !== 'running')
      throw new RunnerInstanceNotAssignableError(runner.id, 'runner-not-running');
    if (!runner.providerRunnerId)
      throw new RunnerInstanceNotAssignableError(runner.id, 'provider-identity-missing');
    if (!runner.controlSessionId)
      throw new RunnerInstanceNotAssignableError(runner.id, 'control-session-not-active');
    if (!reservation.requiredLabels.every((label) => runner.labels.includes(label)))
      throw new RunnerInstanceNotAssignableError(runner.id, 'labels-mismatch');
  }
  if (newRunners.length > 0) {
    const assignedRows = await tx
      .update(providerRunners)
      .set({
        workspaceId: reservation.workspaceId,
        reservationId: reservation.id,
        intendedReservationId: null,
        assignedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        inArray(
          providerRunners.id,
          newRunners.map((runner) => runner.id),
        ),
      )
      .returning({id: providerRunners.id, assignedAt: providerRunners.assignedAt});
    const runnersById = new Map(newRunners.map((runner) => [runner.id, runner]));
    for (const assigned of assignedRows) {
      const runner = runnersById.get(assigned.id);
      const controlSessionCreatedAt = runner?.controlSessionCreatedAt;
      if (!runner || !assigned.assignedAt || !controlSessionCreatedAt) continue;
      recordProviderRunnerControlSessionToAssignment({
        durationMs: assigned.assignedAt.getTime() - controlSessionCreatedAt.getTime(),
        provider: runner.provider ?? 'unknown',
        launchKind: runner.launchKind,
        surface,
      });
    }
  }
  return params.runnerInstanceIds;
}

export type RunnerReservationCapacityFailureReason =
  | 'reservation-not-found'
  | 'reservation-kind-mismatch'
  | 'reservation-expired'
  | 'capacity-exhausted';

export interface RunnerReservationCapacityValidation {
  acceptedByReservation: Map<string, number>;
  unavailableByReservation: Map<
    string,
    {reason: RunnerReservationCapacityFailureReason; count: number}
  >;
}

export async function validateRunnerReservationCapacityTx(
  tx: Tx,
  params: {
    provisionerId: string;
    requests: readonly {reservationId: string; count: number}[];
  },
  options: {advisoryLocksHeld?: boolean} = {},
): Promise<RunnerReservationCapacityValidation> {
  const requestedByReservation = new Map<string, number>();
  for (const request of params.requests) {
    if (request.count <= 0) continue;
    requestedByReservation.set(
      request.reservationId,
      (requestedByReservation.get(request.reservationId) ?? 0) + request.count,
    );
  }
  const reservationIds = [...requestedByReservation.keys()].sort();
  if (reservationIds.length === 0)
    return {acceptedByReservation: new Map(), unavailableByReservation: new Map()};

  if (!options.advisoryLocksHeld)
    await lockRunnerReservationAdvisoryKeysTx(tx, {
      provisionerId: params.provisionerId,
      reservationIds,
    });

  const reservationRows = await tx
    .select({
      id: reservations.id,
      count: reservations.count,
      expiresAt: reservations.expiresAt,
      isExpired: sql<boolean>`${reservations.expiresAt} <= now()`,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.provisionerId, params.provisionerId),
        inArray(reservations.id, reservationIds),
        eq(reservations.kind, 'launch'),
      ),
    )
    .for('update');
  const nonLaunchReservationRows = await tx
    .select({id: reservations.id})
    .from(reservations)
    .where(
      and(
        eq(reservations.provisionerId, params.provisionerId),
        inArray(reservations.id, reservationIds),
        ne(reservations.kind, 'launch'),
      ),
    )
    .for('update');
  const reservationsById = new Map(
    reservationRows.map((reservation) => [reservation.id, reservation]),
  );
  const nonLaunchReservationIds = new Set(
    nonLaunchReservationRows.map((reservation) => reservation.id),
  );
  const requestedReservationIds = new Set(reservationIds);
  const usedRunnerIdsByReservation = new Map<string, Set<string>>();
  const usedRunnerRows = await tx
    .select({
      id: providerRunners.id,
      reservationId: providerRunners.reservationId,
      intendedReservationId: providerRunners.intendedReservationId,
      state: providerRunners.state,
    })
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.provisionerId, params.provisionerId),
        isNull(providerRunners.reservationReleasedAt),
        or(
          inArray(providerRunners.reservationId, reservationIds),
          and(
            inArray(providerRunners.intendedReservationId, reservationIds),
            notInArray(providerRunners.state, [...terminalStates]),
          ),
        ),
      ),
    );
  for (const runner of usedRunnerRows) {
    if (runner.reservationId && requestedReservationIds.has(runner.reservationId)) {
      const usedRunnerIds =
        usedRunnerIdsByReservation.get(runner.reservationId) ?? new Set<string>();
      usedRunnerIds.add(runner.id);
      usedRunnerIdsByReservation.set(runner.reservationId, usedRunnerIds);
    }
    if (
      runner.intendedReservationId &&
      requestedReservationIds.has(runner.intendedReservationId) &&
      !terminalStates.includes(runner.state as (typeof terminalStates)[number])
    ) {
      const usedRunnerIds =
        usedRunnerIdsByReservation.get(runner.intendedReservationId) ?? new Set<string>();
      usedRunnerIds.add(runner.id);
      usedRunnerIdsByReservation.set(runner.intendedReservationId, usedRunnerIds);
    }
  }

  const acceptedByReservation = new Map<string, number>();
  const unavailableByReservation = new Map<
    string,
    {reason: RunnerReservationCapacityFailureReason; count: number}
  >();
  for (const reservationId of reservationIds) {
    const requested = requestedByReservation.get(reservationId) ?? 0;
    const reservation = reservationsById.get(reservationId);
    if (!reservation) {
      unavailableByReservation.set(reservationId, {
        reason: nonLaunchReservationIds.has(reservationId)
          ? 'reservation-kind-mismatch'
          : 'reservation-not-found',
        count: requested,
      });
      continue;
    }
    if (reservation.isExpired) {
      unavailableByReservation.set(reservationId, {
        reason: 'reservation-expired',
        count: requested,
      });
      continue;
    }

    const used = usedRunnerIdsByReservation.get(reservationId)?.size ?? 0;
    const accepted = Math.min(requested, Math.max(0, reservation.count - used));
    acceptedByReservation.set(reservationId, accepted);
    if (accepted < requested) {
      unavailableByReservation.set(reservationId, {
        reason: 'capacity-exhausted',
        count: requested - accepted,
      });
    }
  }

  return {acceptedByReservation, unavailableByReservation};
}
