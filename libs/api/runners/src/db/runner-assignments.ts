import {and, eq, inArray, isNull, ne, notInArray, or, sql} from 'drizzle-orm';
import {
  ReservationExpiredError,
  ReservationNotFoundError,
  RunnerInstanceAlreadyAssignedError,
  RunnerInstanceNotAssignableError,
} from '#core/errors.js';
import {
  type ProviderRunnerAssignmentObservation,
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
  const result = await db().transaction(async (tx) =>
    assignRunnerInstancesTx(tx, {...params, surface: 'provisioner'}),
  );
  for (const observation of result.controlSessionToAssignment)
    recordProviderRunnerControlSessionToAssignment(observation);
  return result.runnerInstanceIds;
}

interface AssignRunnerInstancesTxResult {
  runnerInstanceIds: string[];
  controlSessionToAssignment: ProviderRunnerAssignmentObservation[];
}

export async function assignRunnerInstancesTx(
  tx: Tx,
  params: {
    provisionerId: string;
    reservationId: string;
    runnerInstanceIds: string[];
    surface: RunnerAssignmentSurface;
  },
): Promise<AssignRunnerInstancesTxResult> {
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
  if (assignmentAlreadyCommitted(runnerInstanceIds, runnerRows, params.reservationId)) {
    await tx
      .update(providerRunners)
      .set({intendedReservationId: null, updatedAt: sql`now()`})
      .where(
        and(
          eq(providerRunners.provisionerId, params.provisionerId),
          inArray(providerRunners.id, runnerInstanceIds),
        ),
      );
    return {
      runnerInstanceIds: params.runnerInstanceIds,
      controlSessionToAssignment: [],
    };
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
  assertAssignmentReservation(reservation, params.reservationId);
  assertAllAssignmentRunnersFound(runnerRows.length, runnerInstanceIds);

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

  assertNoConflictingRunnerAssignment(runners, reservation.id);
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
            notInArray(providerRunners.state, [...terminalStates]),
          ),
          and(
            eq(providerRunners.intendedReservationId, reservation.id),
            isNull(providerRunners.reservationReleasedAt),
            notInArray(providerRunners.state, [...terminalStates]),
          ),
        ),
      ),
    );
  assertRunnerAssignmentCapacity(assignedCount[0]?.count ?? 0, newRunners, reservation.count);
  assertRunnersAssignable(newRunners, reservation.requiredLabels);
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
    const controlSessionToAssignment: ProviderRunnerAssignmentObservation[] = [];
    for (const assigned of assignedRows) {
      const runner = runnersById.get(assigned.id);
      const controlSessionCreatedAt = runner?.controlSessionCreatedAt;
      if (!runner || !assigned.assignedAt || !controlSessionCreatedAt) continue;
      controlSessionToAssignment.push({
        durationMilliseconds: assigned.assignedAt.getTime() - controlSessionCreatedAt.getTime(),
        provider: runner.provider,
        launchKind: runner.launchKind,
        surface: params.surface,
        runnerInstanceId: runner.id,
      });
    }
    return {
      runnerInstanceIds: params.runnerInstanceIds,
      controlSessionToAssignment,
    };
  }
  return {
    runnerInstanceIds: params.runnerInstanceIds,
    controlSessionToAssignment: [],
  };
}

type AssignmentRunnerRow = Pick<
  typeof providerRunners.$inferSelect,
  'id' | 'reservationId' | 'assignedAt' | 'workspaceId' | 'state' | 'providerRunnerId' | 'labels'
> & {controlSessionId?: string | null};

function assignmentAlreadyCommitted(
  runnerInstanceIds: readonly string[],
  runnerRows: readonly AssignmentRunnerRow[],
  reservationId: string,
): boolean {
  if (runnerInstanceIds.length === 0 || runnerRows.length !== runnerInstanceIds.length)
    return false;
  return runnerRows.every(
    (runner) =>
      runner.reservationId === reservationId &&
      runner.assignedAt !== null &&
      runner.workspaceId !== null,
  );
}

function assertAssignmentReservation<T extends {expiresAt: Date}>(
  reservation: T | undefined,
  reservationId: string,
): asserts reservation is T {
  if (!reservation) throw new ReservationNotFoundError(reservationId);
  if (reservation.expiresAt <= new Date()) throw new ReservationExpiredError(reservationId);
}

function assertAllAssignmentRunnersFound(
  foundCount: number,
  runnerInstanceIds: readonly string[],
): void {
  if (foundCount !== runnerInstanceIds.length) {
    throw new RunnerInstanceNotAssignableError(runnerInstanceIds[0] ?? '', 'runner-not-found');
  }
}

function assertNoConflictingRunnerAssignment(
  runners: readonly AssignmentRunnerRow[],
  reservationId: string,
): void {
  const conflicting = runners.find(
    (runner) => runner.reservationId !== null && runner.reservationId !== reservationId,
  );
  if (conflicting) throw new RunnerInstanceAlreadyAssignedError(conflicting.id);
}

function assertRunnerAssignmentCapacity(
  assignedCount: number,
  newRunners: readonly AssignmentRunnerRow[],
  reservationCount: number,
): void {
  if (assignedCount + newRunners.length <= reservationCount) return;
  throw new RunnerInstanceNotAssignableError(newRunners[0]?.id ?? '', 'capacity-exhausted');
}

function assertRunnersAssignable(
  runners: readonly AssignmentRunnerRow[],
  requiredLabels: readonly string[],
): void {
  for (const runner of runners) assertRunnerAssignable(runner, requiredLabels);
}

function assertRunnerAssignable(
  runner: AssignmentRunnerRow,
  requiredLabels: readonly string[],
): void {
  if (runner.state !== 'running') {
    throw new RunnerInstanceNotAssignableError(runner.id, 'runner-not-running');
  }
  if (!runner.providerRunnerId) {
    throw new RunnerInstanceNotAssignableError(runner.id, 'provider-identity-missing');
  }
  if (!runner.controlSessionId) {
    throw new RunnerInstanceNotAssignableError(runner.id, 'control-session-not-active');
  }
  if (!requiredLabels.every((label) => runner.labels.includes(label))) {
    throw new RunnerInstanceNotAssignableError(runner.id, 'labels-mismatch');
  }
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
  const requestedByReservation = requestedReservationCounts(params.requests);
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
  const usedRunnerRows = await tx
    .select({
      id: providerRunners.id,
      reservationId: providerRunners.reservationId,
      intendedReservationId: providerRunners.intendedReservationId,
    })
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.provisionerId, params.provisionerId),
        isNull(providerRunners.reservationReleasedAt),
        or(
          and(
            inArray(providerRunners.reservationId, reservationIds),
            notInArray(providerRunners.state, [...terminalStates]),
          ),
          and(
            inArray(providerRunners.intendedReservationId, reservationIds),
            notInArray(providerRunners.state, [...terminalStates]),
          ),
        ),
      ),
    );
  const usedRunnerIdsByReservation = indexUsedRunnerReservations(
    usedRunnerRows,
    new Set(reservationIds),
  );
  return evaluateRunnerReservationCapacity(
    reservationIds,
    requestedByReservation,
    reservationsById,
    nonLaunchReservationIds,
    usedRunnerIdsByReservation,
  );
}

function requestedReservationCounts(
  requests: readonly {reservationId: string; count: number}[],
): Map<string, number> {
  const requested = new Map<string, number>();
  for (const request of requests) {
    if (request.count <= 0) continue;
    requested.set(
      request.reservationId,
      (requested.get(request.reservationId) ?? 0) + request.count,
    );
  }
  return requested;
}

function indexUsedRunnerReservations(
  runners: readonly {
    id: string;
    reservationId: string | null;
    intendedReservationId: string | null;
  }[],
  requestedReservationIds: ReadonlySet<string>,
): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  for (const runner of runners) {
    addUsedRunnerReservation(used, requestedReservationIds, runner.reservationId, runner.id);
    addUsedRunnerReservation(
      used,
      requestedReservationIds,
      runner.intendedReservationId,
      runner.id,
    );
  }
  return used;
}

function addUsedRunnerReservation(
  used: Map<string, Set<string>>,
  requestedReservationIds: ReadonlySet<string>,
  reservationId: string | null,
  runnerId: string,
): void {
  if (reservationId === null || !requestedReservationIds.has(reservationId)) return;
  const runnerIds = used.get(reservationId) ?? new Set<string>();
  runnerIds.add(runnerId);
  used.set(reservationId, runnerIds);
}

function evaluateRunnerReservationCapacity(
  reservationIds: readonly string[],
  requestedByReservation: ReadonlyMap<string, number>,
  reservationsById: ReadonlyMap<string, {count: number; isExpired: boolean}>,
  nonLaunchReservationIds: ReadonlySet<string>,
  usedRunnerIdsByReservation: ReadonlyMap<string, ReadonlySet<string>>,
): RunnerReservationCapacityValidation {
  const result: RunnerReservationCapacityValidation = {
    acceptedByReservation: new Map(),
    unavailableByReservation: new Map(),
  };
  for (const reservationId of reservationIds) {
    evaluateReservationCapacity(
      reservationId,
      requestedByReservation.get(reservationId) ?? 0,
      reservationsById.get(reservationId),
      nonLaunchReservationIds,
      usedRunnerIdsByReservation.get(reservationId)?.size ?? 0,
      result,
    );
  }
  return result;
}

function evaluateReservationCapacity(
  reservationId: string,
  requested: number,
  reservation: {count: number; isExpired: boolean} | undefined,
  nonLaunchReservationIds: ReadonlySet<string>,
  used: number,
  result: RunnerReservationCapacityValidation,
): void {
  if (!reservation) {
    const reason = nonLaunchReservationIds.has(reservationId)
      ? 'reservation-kind-mismatch'
      : 'reservation-not-found';
    result.unavailableByReservation.set(reservationId, {reason, count: requested});
    return;
  }
  if (reservation.isExpired) {
    result.unavailableByReservation.set(reservationId, {
      reason: 'reservation-expired',
      count: requested,
    });
    return;
  }
  const accepted = Math.min(requested, Math.max(0, reservation.count - used));
  result.acceptedByReservation.set(reservationId, accepted);
  if (accepted < requested) {
    result.unavailableByReservation.set(reservationId, {
      reason: 'capacity-exhausted',
      count: requested - accepted,
    });
  }
}
