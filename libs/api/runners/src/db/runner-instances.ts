import {logger} from '@shipfox/node-opentelemetry';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import {alias} from 'drizzle-orm/pg-core';
import {config} from '#config.js';
import type {
  RunnerInstance,
  RunnerInstanceState,
  RunnerTerminationReason,
} from '#core/entities/runner-instance.js';
import {sanitizeRunnerLabels} from '#core/runner-labels.js';
import {
  recordRunnerEnrollmentCredentialRevoked,
  recordRunnerReservationCapacityFailure,
} from '#metrics/index.js';
import type {RunnerTerminationAuthorizationRejectionReason} from '#metrics/instance.js';
import type {Tx} from './db.js';
import {db} from './db.js';
import {lockRunnerEnrollmentTx} from './enrollment-locks.js';
import {
  listRunningJobExecutionsByRunnerInstanceTx,
  type RunnerInstanceBoundJobExecution,
} from './job-executions.js';
import {lockRunnerReservationAdvisoryKeysTx} from './reservation-locks.js';
import {releaseTerminalRunnerInstanceReservationsByIds} from './reservations.js';
import {validateRunnerReservationCapacityTx} from './runner-assignments.js';
import {activeStates, terminalStates} from './runner-states.js';
import {provisionerTokens} from './schema/provisioner-tokens.js';
import {reservations} from './schema/reservations.js';
import {runnerActivationTokens} from './schema/runner-activation-tokens.js';
import {runnerControlSessions} from './schema/runner-control-sessions.js';
import {providerRunners, toRunnerInstance} from './schema/runner-instances.js';
import {runnerSessions} from './schema/runner-sessions.js';
import {runningJobExecutions} from './schema/running-job-executions.js';

export const divergenceCountStates = ['starting', 'running'] as const satisfies readonly Extract<
  RunnerInstanceState,
  'starting' | 'running'
>[];

export type RunnerInstanceTerminateIntentReason = RunnerTerminationReason;

export type {RunnerTerminationReason} from '#core/entities/runner-instance.js';

export type TerminationAuthorizationResult =
  | {desiredIntent: 'keep'; terminationAuthorizedAt: null; terminationReason: null}
  | {
      desiredIntent: 'terminate';
      terminationAuthorizedAt: Date;
      terminationReason: RunnerTerminationReason;
    };

export type TerminationReasonResolution =
  | {reason: RunnerTerminationReason; rejectionReason?: never}
  | {reason: null; rejectionReason: RunnerTerminationAuthorizationRejectionReason};

export type TerminationAuthorizationTelemetry =
  | {outcome: 'issued'; reason: RunnerTerminationReason}
  | {outcome: 'rejected'; reason: RunnerTerminationAuthorizationRejectionReason};

export type TerminationAuthorizationTxResult = TerminationAuthorizationResult & {
  /** Emitted by the transaction owner only after the transaction commits. */
  telemetry: TerminationAuthorizationTelemetry | null;
};

interface PersistRunnerTerminationAuthorizationParams {
  provisionerId: string;
  providerRunnerId: string;
  reason: string;
  resolveTerminationReason: (reason: string) => TerminationReasonResolution;
}

export interface RunnerEnrollmentRevocationCounts {
  runnerInstanceId: string;
  revokedActivationTokenCount: number;
  closedControlSessionCount: number;
}

export async function persistRunnerTerminationAuthorization(
  params: PersistRunnerTerminationAuthorizationParams,
): Promise<TerminationAuthorizationTxResult> {
  let revocationCounts: RunnerEnrollmentRevocationCounts | undefined;
  const result = await db().transaction((tx) =>
    persistRunnerTerminationAuthorizationTx(tx, params, (counts) => {
      revocationCounts = counts;
    }),
  );
  if (revocationCounts) {
    recordRunnerEnrollmentCredentialRevoked({
      credential: 'activation-token',
      count: revocationCounts.revokedActivationTokenCount,
    });
    recordRunnerEnrollmentCredentialRevoked({
      credential: 'control-session',
      count: revocationCounts.closedControlSessionCount,
    });
    if (
      revocationCounts.revokedActivationTokenCount > 0 ||
      revocationCounts.closedControlSessionCount > 0
    )
      logger().info(
        {
          runnerInstanceId: revocationCounts.runnerInstanceId,
          revokedActivationTokenCount: revocationCounts.revokedActivationTokenCount,
          closedControlSessionCount: revocationCounts.closedControlSessionCount,
        },
        'Revoked runner enrollment credentials after termination authorization',
      );
  }
  return result;
}

export async function persistRunnerTerminationAuthorizationTx(
  tx: Tx,
  params: PersistRunnerTerminationAuthorizationParams,
  onRevocation?: (counts: RunnerEnrollmentRevocationCounts) => void,
): Promise<TerminationAuthorizationTxResult> {
  const [candidate] = await tx
    .select({id: providerRunners.id, workspaceId: providerRunners.workspaceId})
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.provisionerId, params.provisionerId),
        eq(providerRunners.providerRunnerId, params.providerRunnerId),
      ),
    )
    .limit(1);

  if (!candidate?.workspaceId) {
    return {
      desiredIntent: 'keep',
      terminationAuthorizedAt: null,
      terminationReason: null,
      telemetry: {outcome: 'rejected', reason: 'unknown-runner'},
    };
  }

  await lockRunnerEnrollmentTx(tx, {
    workspaceId: candidate.workspaceId,
    runnerInstanceId: candidate.id,
  });
  const [runner] = await tx
    .select({
      id: providerRunners.id,
      terminationAuthorizedAt: providerRunners.terminationAuthorizedAt,
      terminationReason: providerRunners.terminationReason,
    })
    .from(providerRunners)
    // The runner lock serializes rebinding with this read. Use the current row
    // after taking it so cleanup that clears workspaceId is still authorized.
    .where(eq(providerRunners.id, candidate.id))
    .limit(1)
    .for('update');
  if (!runner) throw new Error('Termination authorization runner disappeared');

  if (!runner.terminationAuthorizedAt || !runner.terminationReason) {
    const resolution = params.resolveTerminationReason(params.reason);
    if (!resolution.reason)
      return {
        desiredIntent: 'keep',
        terminationAuthorizedAt: null,
        terminationReason: null,
        telemetry: {outcome: 'rejected', reason: resolution.rejectionReason},
      };
    const authorizedAt = new Date();
    const [authorized] = await tx
      .update(providerRunners)
      .set({
        terminationAuthorizedAt: authorizedAt,
        terminationReason: resolution.reason,
        updatedAt: authorizedAt,
      })
      .where(eq(providerRunners.id, runner.id))
      .returning({
        terminationAuthorizedAt: providerRunners.terminationAuthorizedAt,
        terminationReason: providerRunners.terminationReason,
      });
    if (!authorized?.terminationAuthorizedAt || !authorized.terminationReason)
      throw new Error('Termination authorization was not persisted');
    await revokeRunnerEnrollmentCredentialsTx(tx, candidate.id, onRevocation);
    return {
      desiredIntent: 'terminate',
      terminationAuthorizedAt: authorized.terminationAuthorizedAt,
      terminationReason: authorized.terminationReason,
      telemetry: {outcome: 'issued', reason: authorized.terminationReason},
    };
  }

  await revokeRunnerEnrollmentCredentialsTx(tx, candidate.id, onRevocation);
  return {
    desiredIntent: 'terminate',
    terminationAuthorizedAt: runner.terminationAuthorizedAt,
    terminationReason: runner.terminationReason,
    telemetry: null,
  };
}

/**
 * Revocation is an intentional, non-revertible data side effect of termination authorization.
 */
async function revokeRunnerEnrollmentCredentialsTx(
  tx: Tx,
  runnerInstanceId: string,
  onRevocation?: (counts: RunnerEnrollmentRevocationCounts) => void,
): Promise<void> {
  const revokedTokens = await tx
    .update(runnerActivationTokens)
    .set({revokedAt: sql`now()`})
    .where(
      and(
        eq(runnerActivationTokens.runnerInstanceId, runnerInstanceId),
        isNull(runnerActivationTokens.consumedAt),
        isNull(runnerActivationTokens.revokedAt),
      ),
    );
  const closedControlSessions = await tx
    .update(runnerControlSessions)
    .set({closedAt: sql`now()`, closeReason: 'termination-authorized'})
    .where(
      and(
        eq(runnerControlSessions.runnerInstanceId, runnerInstanceId),
        isNull(runnerControlSessions.closedAt),
      ),
    );
  onRevocation?.({
    runnerInstanceId,
    revokedActivationTokenCount: revokedTokens.rowCount ?? 0,
    closedControlSessionCount: closedControlSessions.rowCount ?? 0,
  });
}

export interface RunnerInstanceTerminateIntent {
  providerRunnerId: string;
  reason: RunnerInstanceTerminateIntentReason;
  activationTimeoutRetry?: boolean;
}

type HonoredRunnerInstanceTerminateIntent = RunnerInstanceTerminateIntent & {
  origin: 'durable' | 'legacy';
};

type ProvisionerTerminateIntentRow = {
  providerRunnerId: string | null;
  reason: RunnerInstanceTerminateIntentReason;
  activationTimeoutRetry: boolean;
};

export interface ActiveRunnerInstanceTemplateCount {
  templateKey: string;
  state: (typeof divergenceCountStates)[number];
  count: number;
}

export interface RunnerInstanceReportEvent {
  providerRunnerId: string;
  reservationId: string | null;
  templateKey: string | null;
  labels: string[];
  state: RunnerInstanceState;
  reason: string | null;
  runnerSessionId: string | null;
  providerKind: string | null;
  reportedAt: Date;
}

export interface ReportRunnerInstancesParams {
  scope: 'installation' | 'workspace';
  workspaceId: string | null;
  provisionerId: string;
  events: RunnerInstanceReportEvent[];
}

export interface ReconcileRunnerInstancesParams {
  workspaceId: string | null;
  provisionerId: string;
  observedRunnerInstanceIds: string[];
  terminateGraceSeconds: number;
  postJobExitGraceSeconds?: number;
  terminationReasonResolver?: (params: {
    provisionerId: string;
    providerRunnerId: string;
    reason: string;
  }) => TerminationReasonResolution;
}

export interface ReconcileRunnerInstancesDbResult {
  observedRows: RunnerInstance[];
  boundJobExecutionsByRunnerInstanceId: Map<string, RunnerInstanceBoundJobExecution>;
  absentIds: string[];
  reservationsReleased: number;
}

export interface ReapStaleRunnerInstancesResult {
  reaped: number;
  reservationsReleased: number;
}

export async function attachRunnerInstanceProviderId(params: {
  runnerInstanceId: string;
  provisionerId: string;
  providerRunnerId: string;
}): Promise<boolean> {
  const updated = await db()
    .update(providerRunners)
    .set({providerRunnerId: params.providerRunnerId, updatedAt: sql`now()`})
    .where(
      and(
        eq(providerRunners.id, params.runnerInstanceId),
        eq(providerRunners.provisionerId, params.provisionerId),
        isNull(providerRunners.providerRunnerId),
        notInArray(providerRunners.state, [...terminalStates]),
      ),
    )
    .returning({id: providerRunners.id});
  return updated.length === 1;
}

interface RunnerInstanceReportRow extends RunnerInstanceReportEvent {
  startedAt: Date | null;
  stoppingAt: Date | null;
  stoppedAt: Date | null;
  failedAt: Date | null;
  terminatedAt: Date | null;
}

type RunnerInstanceMilestoneColumn =
  | typeof providerRunners.startedAt
  | typeof providerRunners.stoppingAt
  | typeof providerRunners.stoppedAt
  | typeof providerRunners.failedAt
  | typeof providerRunners.terminatedAt;

export async function reportRunnerInstances(params: ReportRunnerInstancesParams): Promise<{
  accepted: number;
  reservationsReleased: number;
  terminateIntentsHonored: HonoredRunnerInstanceTerminateIntent[];
}> {
  if (params.events.length === 0)
    return {accepted: 0, reservationsReleased: 0, terminateIntentsHonored: []};

  return await db().transaction(async (tx) => {
    const receivedAt = new Date();
    const aggregatedEvents = aggregateEvents(params.events, receivedAt);
    const hasTerminalEvent = aggregatedEvents.some((event) => isTerminalState(event.state));

    if (hasTerminalEvent) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${params.workspaceId ?? params.provisionerId}))`,
      );
    }

    const events = aggregatedEvents;
    const reservationSafeEvents = await guardReportedReservationIdsTx(tx, params, events);
    const existingReportedAtByProviderRunnerId = hasTerminalEvent
      ? await listExistingProviderRunnerReportedAtTx(tx, params, reservationSafeEvents)
      : new Map<string, Date>();
    const freshTerminalEvents = reservationSafeEvents.filter((event) => {
      if (!isTerminalState(event.state)) return false;
      const existingReportedAt = existingReportedAtByProviderRunnerId.get(event.providerRunnerId);
      return existingReportedAt === undefined || event.reportedAt >= existingReportedAt;
    });
    const terminateIntentsHonored = await listTerminateIntentsHonoredByTerminatedReportsTx(
      tx,
      params,
      reservationSafeEvents,
    );

    const values = reservationSafeEvents.map((event) => ({
      workspaceId: params.workspaceId,
      provisionerId: params.provisionerId,
      providerRunnerId: event.providerRunnerId,
      reservationId: event.reservationId,
      templateKey: event.templateKey,
      labels: sanitizeRunnerLabels(event.labels, {
        scope: params.scope,
        logLevel: 'debug',
        source: 'runner instance report',
      }),
      state: event.state,
      reason: event.reason,
      runnerSessionId: event.runnerSessionId,
      providerKind: event.providerKind,
      reportedAt: event.reportedAt > receivedAt ? receivedAt : event.reportedAt,
      startedAt: event.startedAt,
      stoppingAt: event.stoppingAt,
      stoppedAt: event.stoppedAt,
      failedAt: event.failedAt,
      terminatedAt: event.terminatedAt,
    }));

    await tx
      .insert(providerRunners)
      .values(values)
      .onConflictDoUpdate({
        target: [providerRunners.provisionerId, providerRunners.providerRunnerId],
        targetWhere: isNotNull(providerRunners.providerRunnerId),
        set: {
          reservationId: sql`CASE WHEN ${providerRunnerProjectionUpdateCondition()} THEN coalesce(${providerRunners.reservationId}, excluded.reservation_id) ELSE ${providerRunners.reservationId} END`,
          templateKey: sql`CASE WHEN ${providerRunnerProjectionUpdateCondition()} THEN coalesce(excluded.template_key, ${providerRunners.templateKey}) ELSE ${providerRunners.templateKey} END`,
          labels: sql`CASE WHEN ${providerRunnerProjectionUpdateCondition()} THEN excluded.labels ELSE ${providerRunners.labels} END`,
          state: sql`CASE WHEN ${providerRunnerProjectionUpdateCondition()} THEN excluded.state ELSE ${providerRunners.state} END`,
          reason: sql`CASE WHEN ${providerRunnerProjectionUpdateCondition()} THEN excluded.reason ELSE ${providerRunners.reason} END`,
          runnerSessionId: sql`CASE WHEN ${providerRunnerProjectionUpdateCondition()} THEN coalesce(${providerRunners.runnerSessionId}, excluded.runner_session_id) ELSE ${providerRunners.runnerSessionId} END`,
          providerKind: sql`CASE WHEN ${providerRunnerProjectionUpdateCondition()} THEN coalesce(excluded.provider_kind, ${providerRunners.providerKind}) ELSE ${providerRunners.providerKind} END`,
          reportedAt: sql`CASE WHEN ${providerRunnerProjectionUpdateCondition()} THEN excluded.reported_at ELSE ${providerRunners.reportedAt} END`,
          startedAt: firstObservedAt(providerRunners.startedAt, sql`excluded.started_at`),
          stoppingAt: firstObservedAt(providerRunners.stoppingAt, sql`excluded.stopping_at`),
          stoppedAt: firstObservedAt(providerRunners.stoppedAt, sql`excluded.stopped_at`),
          failedAt: firstObservedAt(providerRunners.failedAt, sql`excluded.failed_at`),
          terminatedAt: firstObservedAt(providerRunners.terminatedAt, sql`excluded.terminated_at`),
          updatedAt: sql`now()`,
        },
        setWhere: sql`
          ${providerRunnerProjectionUpdateCondition()}
          OR ${providerRunnerMilestoneUpdateCondition()}
        `,
      });

    const reservationsReleased =
      freshTerminalEvents.length > 0
        ? await releaseTerminalRunnerInstanceReservations(tx, params, freshTerminalEvents)
        : 0;

    return {
      accepted: reservationSafeEvents.length,
      reservationsReleased,
      terminateIntentsHonored,
    };
  });
}

async function listExistingProviderRunnerReportedAtTx(
  tx: Tx,
  params: ReportRunnerInstancesParams,
  events: RunnerInstanceReportRow[],
): Promise<Map<string, Date>> {
  const providerRunnerIds = [...new Set(events.map((event) => event.providerRunnerId))];
  if (providerRunnerIds.length === 0) return new Map();

  const rows = await tx
    .select({
      providerRunnerId: providerRunners.providerRunnerId,
      reportedAt: providerRunners.reportedAt,
    })
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.provisionerId, params.provisionerId),
        inArray(providerRunners.providerRunnerId, providerRunnerIds),
      ),
    );
  return new Map(
    rows.flatMap((row) =>
      row.providerRunnerId ? [[row.providerRunnerId, row.reportedAt] as const] : [],
    ),
  );
}

async function guardReportedReservationIdsTx(
  tx: Tx,
  params: ReportRunnerInstancesParams,
  events: RunnerInstanceReportRow[],
): Promise<RunnerInstanceReportRow[]> {
  const reportedReservationIds = [
    ...new Set(events.flatMap((event) => (event.reservationId ? [event.reservationId] : []))),
  ].sort();
  const providerRunnerIds = [...new Set(events.map((event) => event.providerRunnerId))];
  if (reportedReservationIds.length === 0 && !events.some((event) => isTerminalState(event.state)))
    return events;

  // Lock every reservation currently associated with the reported runners before taking a
  // runner row lock. Terminal reports may omit reservationId, or carry a stale one; discovering
  // the stored IDs here keeps report projection in the same reservation-then-runner order as
  // assignment and terminal cleanup.
  const existingReservationRows = await tx
    .select({
      reservationId: providerRunners.reservationId,
      intendedReservationId: providerRunners.intendedReservationId,
    })
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.provisionerId, params.provisionerId),
        inArray(providerRunners.providerRunnerId, providerRunnerIds),
      ),
    );
  const storedReservationIds = existingReservationRows.flatMap((row) =>
    [row.reservationId, row.intendedReservationId].filter(
      (reservationId): reservationId is string => reservationId !== null,
    ),
  );
  const reservationIds = [...new Set([...reportedReservationIds, ...storedReservationIds])].sort();
  if (reservationIds.length > 0)
    await lockRunnerReservationAdvisoryKeysTx(tx, {
      provisionerId: params.provisionerId,
      reservationIds,
    });

  const existingRows = await tx
    .select({
      providerRunnerId: providerRunners.providerRunnerId,
      reservationId: providerRunners.reservationId,
      intendedReservationId: providerRunners.intendedReservationId,
      reservationReleasedAt: providerRunners.reservationReleasedAt,
    })
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.provisionerId, params.provisionerId),
        inArray(providerRunners.providerRunnerId, providerRunnerIds),
      ),
    )
    .for('update');
  const existingByProviderRunnerId = new Map(
    existingRows.flatMap((row) =>
      row.providerRunnerId ? [[row.providerRunnerId, row] as const] : [],
    ),
  );
  const candidateReservationByProviderRunnerId = new Map<string, string>();
  for (const event of events) {
    if (!event.reservationId) continue;
    if (isTerminalState(event.state)) continue;
    const existing = existingByProviderRunnerId.get(event.providerRunnerId);
    if (existing?.reservationId || existing?.intendedReservationId === event.reservationId)
      continue;
    if (existing?.intendedReservationId || existing?.reservationReleasedAt) continue;
    candidateReservationByProviderRunnerId.set(event.providerRunnerId, event.reservationId);
  }

  const validation = await validateRunnerReservationCapacityTx(
    tx,
    {
      provisionerId: params.provisionerId,
      requests: [...candidateReservationByProviderRunnerId.values()].map((reservationId) => ({
        reservationId,
        count: 1,
      })),
    },
    {advisoryLocksHeld: true},
  );
  for (const {reason, count} of validation.unavailableByReservation.values())
    recordRunnerReservationCapacityFailure(reason, count);

  const remainingAcceptedByReservation = new Map(validation.acceptedByReservation);
  return events.map((event) =>
    guardReportedReservationEvent(
      event,
      existingByProviderRunnerId,
      candidateReservationByProviderRunnerId,
      remainingAcceptedByReservation,
    ),
  );
}

function guardReportedReservationEvent(
  event: RunnerInstanceReportRow,
  existingByProviderRunnerId: ReadonlyMap<
    string,
    {
      reservationId: string | null;
      intendedReservationId: string | null;
      reservationReleasedAt: Date | null;
    }
  >,
  candidateReservationByProviderRunnerId: ReadonlyMap<string, string>,
  remainingAcceptedByReservation: Map<string, number>,
): RunnerInstanceReportRow {
  const existing = existingByProviderRunnerId.get(event.providerRunnerId);
  const reservationId = candidateReservationByProviderRunnerId.get(event.providerRunnerId);
  if (!reservationId) return guardNonCandidateReservationEvent(event, existing);
  const remaining = remainingAcceptedByReservation.get(reservationId) ?? 0;
  if (remaining === 0) return {...event, reservationId: null};
  remainingAcceptedByReservation.set(reservationId, remaining - 1);
  return event;
}

function guardNonCandidateReservationEvent(
  event: RunnerInstanceReportRow,
  existing:
    | {
        reservationId: string | null;
        intendedReservationId: string | null;
        reservationReleasedAt: Date | null;
      }
    | undefined,
): RunnerInstanceReportRow {
  if (event.reservationId && isTerminalState(event.state)) {
    const matchesExisting =
      existing !== undefined &&
      (existing.reservationId === event.reservationId ||
        existing.intendedReservationId === event.reservationId);
    if (!matchesExisting) return {...event, reservationId: null};
  }
  if (
    event.reservationId &&
    existing?.intendedReservationId &&
    existing.intendedReservationId !== event.reservationId
  ) {
    return {...event, reservationId: null};
  }
  if (event.reservationId && existing?.reservationReleasedAt) {
    return {...event, reservationId: null};
  }
  return event;
}

export async function listActiveRunnerInstanceCountsByTemplateTx(
  tx: Tx,
  params: {workspaceId: string; provisionerId: string},
): Promise<ActiveRunnerInstanceTemplateCount[]> {
  const rows = await tx
    .select({
      templateKey: providerRunners.templateKey,
      state: providerRunners.state,
      count: sql<number>`count(*)::int`,
    })
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.workspaceId, params.workspaceId),
        eq(providerRunners.provisionerId, params.provisionerId),
        inArray(providerRunners.state, divergenceCountStates),
        isNotNull(providerRunners.templateKey),
      ),
    )
    .groupBy(providerRunners.templateKey, providerRunners.state);

  return rows.flatMap((row) =>
    row.templateKey && isDivergenceCountState(row.state)
      ? [{templateKey: row.templateKey, state: row.state, count: row.count}]
      : [],
  );
}

export async function countStaleEnrolledRunnerInstances(params: {
  graceSeconds: number;
}): Promise<number> {
  const [row] = await db()
    .select({count: sql<number>`count(*)::int`})
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.state, 'running'),
        isNull(providerRunners.workspaceId),
        isNull(providerRunners.runnerSessionId),
        lt(providerRunners.reportedAt, staleRunnerInstanceCutoff(params.graceSeconds)),
        exists(
          db()
            .select({id: runnerControlSessions.id})
            .from(runnerControlSessions)
            .where(
              and(
                eq(runnerControlSessions.runnerInstanceId, providerRunners.id),
                isNull(runnerControlSessions.closedAt),
                gt(runnerControlSessions.expiresAt, sql`now()`),
              ),
            ),
        ),
      ),
    );

  return row?.count ?? 0;
}

export type ProviderRunnerPhase =
  | 'control_session'
  | 'enrollment'
  | 'assignment'
  | 'activation'
  | 'idle';

export interface ProviderRunnerPhaseMetric {
  phase: ProviderRunnerPhase;
  provider: string;
  launchKind: 'demand' | 'warm' | 'manual';
  count: number;
  oldestAgeMilliseconds: number;
}

export type ProviderRunnerStateMetric = {
  state: (typeof activeStates)[number];
  count: number;
  oldestAgeMilliseconds: number;
};

/**
 * Returns current managed runner capacity by bounded lifecycle state. The age is measured from
 * provider-runner creation so it remains useful while a runner moves between active states.
 */
export async function listProviderRunnerByStateMetrics(): Promise<ProviderRunnerStateMetric[]> {
  const rows = await db()
    .select({
      state: providerRunners.state,
      count: sql<number>`count(*)::int`,
      oldestAgeMilliseconds: sql<number>`coalesce(
        max(extract(epoch from (now() - ${providerRunners.createdAt})) * 1000),
        0
      )::double precision`,
    })
    .from(providerRunners)
    .where(
      and(
        inArray(providerRunners.state, [...activeStates]),
        isNotNull(providerRunners.providerRunnerId),
      ),
    )
    .groupBy(providerRunners.state);

  return rows.map((row) => ({
    state: row.state as (typeof activeStates)[number],
    count: row.count,
    oldestAgeMilliseconds: Math.max(0, row.oldestAgeMilliseconds),
  }));
}

export async function listProviderRunnerByPhaseMetrics(): Promise<ProviderRunnerPhaseMetric[]> {
  const phase = sql<ProviderRunnerPhase>`case
    when ${runnerControlSessions.id} is null then 'control_session'
    when ${providerRunners.state} <> 'running' then 'enrollment'
    when ${providerRunners.intendedReservationId} is not null
      and ${providerRunners.workspaceId} is null then 'assignment'
    when ${providerRunners.workspaceId} is not null then 'activation'
    else 'idle'
  end`;
  const startedAt = sql<Date | null>`case
    when ${runnerControlSessions.id} is null then ${providerRunners.createdAt}
    when ${providerRunners.state} <> 'running' then ${runnerControlSessions.createdAt}
    when ${providerRunners.intendedReservationId} is not null
      and ${providerRunners.workspaceId} is null then ${runnerControlSessions.createdAt}
    when ${providerRunners.workspaceId} is not null
      then coalesce(${providerRunners.assignedAt}, ${runnerControlSessions.createdAt})
    else coalesce(
      ${runnerControlSessions.createdAt},
      ${providerRunners.assignedAt},
      ${providerRunners.createdAt}
    )
  end`;
  const rows = await db()
    .select({
      phase,
      provider: sql<string>`coalesce(${providerRunners.providerKind}, 'unknown')`,
      launchKind: providerRunners.launchKind,
      count: sql<number>`count(*)::int`,
      oldestAgeMilliseconds: sql<number>`coalesce(
        max(extract(epoch from (now() - (${startedAt}))) * 1000),
        0
      )::double precision`,
    })
    .from(providerRunners)
    .leftJoin(
      runnerControlSessions,
      and(
        eq(runnerControlSessions.runnerInstanceId, providerRunners.id),
        isNull(runnerControlSessions.closedAt),
        gt(runnerControlSessions.expiresAt, sql`now()`),
      ),
    )
    .where(
      and(
        inArray(providerRunners.state, ['starting', 'running']),
        isNull(providerRunners.runnerSessionId),
      ),
    )
    .groupBy(phase, providerRunners.providerKind, providerRunners.launchKind);

  return rows.map((row) => ({
    phase: row.phase,
    provider: row.provider,
    launchKind: row.launchKind,
    count: row.count,
    oldestAgeMilliseconds: Math.max(0, row.oldestAgeMilliseconds),
  }));
}

export async function listActiveRunnerInstances(params: {
  workspaceId: string;
  windowSeconds: number;
  limit?: number;
}): Promise<RunnerInstance[]> {
  const rows = await db()
    .select()
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.workspaceId, params.workspaceId),
        inArray(providerRunners.state, activeStates),
        sql`${providerRunners.updatedAt} > now() - (${params.windowSeconds} || ' seconds')::interval`,
      ),
    )
    .orderBy(desc(providerRunners.updatedAt), desc(providerRunners.id))
    .limit(params.limit ?? 1000);

  return rows.map(toRunnerInstance);
}

export async function listProvisionerTerminateIntents(params: {
  workspaceId: string;
  provisionerId: string;
  limit: number;
}): Promise<string[]> {
  return await db().transaction(async (tx) => {
    const rows = await listProvisionerTerminateIntentRowsTx(tx, params);
    return rows.map((row) => row.providerRunnerId);
  });
}

/** Return the durable termination decisions that are ready for provisioner delivery. */
export async function listProvisionerTerminationAuthorizations(params: {
  workspaceId: string | null;
  provisionerId: string;
  providerRunnerIds?: string[];
  limit: number;
}): Promise<RunnerInstanceTerminateIntent[]> {
  return await db().transaction((tx) => listProvisionerTerminationAuthorizationsTx(tx, params));
}

export async function listProvisionerTerminationAuthorizationsTx(
  tx: Tx,
  params: {
    workspaceId: string | null;
    provisionerId: string;
    providerRunnerIds?: string[];
    limit: number;
  },
): Promise<RunnerInstanceTerminateIntent[]> {
  const rows = await tx
    .select({
      providerRunnerId: providerRunners.providerRunnerId,
      terminationReason: providerRunners.terminationReason,
      // The legacy query owns the first-delivery/retry signal. A durable
      // authorization has no reliable delivery marker, so it is a first
      // delivery when it is not also returned by that compatibility query.
      activationTimeoutRetry: sql<boolean>`false`,
    })
    .from(providerRunners)
    .where(
      and(
        params.workspaceId
          ? eq(providerRunners.workspaceId, params.workspaceId)
          : isNull(providerRunners.workspaceId),
        eq(providerRunners.provisionerId, params.provisionerId),
        // Terminal runners are handled by reconcile's compatibility adapter;
        // poll-demand only needs authorizations for runners still awaiting
        // provisioner action.
        inArray(providerRunners.state, activeStates),
        isNotNull(providerRunners.providerRunnerId),
        isNotNull(providerRunners.terminationAuthorizedAt),
        isNotNull(providerRunners.terminationReason),
        params.providerRunnerIds && params.providerRunnerIds.length > 0
          ? inArray(providerRunners.providerRunnerId, params.providerRunnerIds)
          : undefined,
      ),
    )
    .orderBy(asc(providerRunners.providerRunnerId))
    .limit(params.limit);

  return rows.flatMap((row) =>
    row.providerRunnerId && row.terminationReason
      ? [
          {
            providerRunnerId: row.providerRunnerId,
            reason: row.terminationReason,
            ...(row.terminationReason === 'activation-timeout' && row.activationTimeoutRetry
              ? {activationTimeoutRetry: true}
              : {}),
          },
        ]
      : [],
  );
}

export async function listProvisionerTerminateIntentRowsTx(
  tx: Tx,
  params: {
    workspaceId: string;
    provisionerId: string;
    limit: number;
  },
  options?: {
    authorize?: (params: {
      providerRunnerId: string;
      reason: RunnerInstanceTerminateIntentReason;
    }) => Promise<boolean>;
  },
): Promise<RunnerInstanceTerminateIntent[]> {
  let returnedRows: ProvisionerTerminateIntentRow[];
  let truncated: boolean;
  if (options?.authorize) {
    ({rows: returnedRows, truncated} = await listAuthorizedProvisionerTerminateIntentRowsTx(
      tx,
      params,
      options.authorize,
    ));
  } else {
    const rows = await provisionerTerminateIntentsQuery(tx, params)
      .orderBy(asc(providerRunners.providerRunnerId))
      .limit(params.limit + 1);
    truncated = rows.length > params.limit;
    returnedRows = truncated ? rows.slice(0, params.limit) : rows;
  }

  if (truncated) {
    logger().warn(
      {
        workspaceId: params.workspaceId,
        provisionerId: params.provisionerId,
        limit: params.limit,
        returnedCount: returnedRows.length,
      },
      'provisioner terminate intents truncated by poll-demand limit',
    );
  }

  const activationTimeoutRunnerIds = returnedRows.flatMap((row) =>
    row.reason === 'activation-timeout' && row.providerRunnerId ? [row.providerRunnerId] : [],
  );
  if (activationTimeoutRunnerIds.length > 0) {
    await tx
      .update(providerRunners)
      .set({reservationReleasedAt: sql`now()`, updatedAt: sql`now()`})
      .where(
        and(
          eq(providerRunners.workspaceId, params.workspaceId),
          eq(providerRunners.provisionerId, params.provisionerId),
          inArray(providerRunners.providerRunnerId, activationTimeoutRunnerIds),
          isNull(providerRunners.reservationReleasedAt),
        ),
      );
  }

  return returnedRows.flatMap((row) => toRunnerInstanceTerminateIntent(row));
}

async function listAuthorizedProvisionerTerminateIntentRowsTx(
  tx: Tx,
  params: {workspaceId: string; provisionerId: string; limit: number},
  authorize: (params: {
    providerRunnerId: string;
    reason: RunnerInstanceTerminateIntentReason;
  }) => Promise<boolean>,
): Promise<{rows: ProvisionerTerminateIntentRow[]; truncated: boolean}> {
  const authorizedRows: ProvisionerTerminateIntentRow[] = [];
  let providerRunnerIdAfter: string | undefined;

  while (authorizedRows.length < params.limit) {
    const remaining = params.limit - authorizedRows.length;
    const rows = await provisionerTerminateIntentsQuery(
      tx,
      providerRunnerIdAfter ? {...params, providerRunnerIdAfter} : params,
    )
      .orderBy(asc(providerRunners.providerRunnerId))
      .limit(remaining + 1);
    const candidateRows = rows.length > remaining ? rows.slice(0, remaining) : rows;
    const authorizedPageRows = await filterAuthorizedTerminateIntentRows(candidateRows, authorize);
    authorizedRows.push(...authorizedPageRows);

    if (authorizedRows.length >= params.limit) {
      return {
        rows: authorizedRows,
        truncated: rows.length > candidateRows.length,
      };
    }
    if (rows.length <= remaining) break;

    const lastCandidateRow = candidateRows.at(-1);
    if (!lastCandidateRow?.providerRunnerId) break;
    providerRunnerIdAfter = lastCandidateRow.providerRunnerId;
  }

  return {rows: authorizedRows, truncated: false};
}

async function filterAuthorizedTerminateIntentRows(
  rows: ProvisionerTerminateIntentRow[],
  authorize: (params: {
    providerRunnerId: string;
    reason: RunnerInstanceTerminateIntentReason;
  }) => Promise<boolean>,
): Promise<typeof rows> {
  const authorizedRows: typeof rows = [];
  for (const row of rows) {
    if (!row.providerRunnerId) continue;
    if (!(await authorize({providerRunnerId: row.providerRunnerId, reason: row.reason}))) continue;
    authorizedRows.push(row);
  }
  return authorizedRows;
}

function toRunnerInstanceTerminateIntent(row: {
  providerRunnerId: string | null;
  reason: RunnerInstanceTerminateIntentReason;
  activationTimeoutRetry: boolean;
}): RunnerInstanceTerminateIntent[] {
  if (!row.providerRunnerId) return [];

  return [
    {
      providerRunnerId: row.providerRunnerId,
      reason: row.reason,
      ...(row.reason === 'activation-timeout' && row.activationTimeoutRetry
        ? {activationTimeoutRetry: true}
        : {}),
    },
  ];
}

function provisionerTerminateIntentsQuery(
  tx: Tx,
  params: {
    workspaceId: string;
    provisionerId: string;
    providerRunnerIds?: string[];
    providerRunnerIdAfter?: string;
  },
) {
  const newerRunningJobExecutions = alias(runningJobExecutions, 'newer_running_jobs');
  const latestCancelledJob = exists(
    tx
      .select({id: runningJobExecutions.id})
      .from(runningJobExecutions)
      .where(
        and(
          eq(runningJobExecutions.workspaceId, params.workspaceId),
          eq(runningJobExecutions.provisionerId, params.provisionerId),
          eq(runningJobExecutions.providerRunnerId, providerRunners.providerRunnerId),
          isNotNull(runningJobExecutions.cancellationRequestedAt),
          notExists(
            tx
              .select({id: newerRunningJobExecutions.id})
              .from(newerRunningJobExecutions)
              .where(
                and(
                  eq(newerRunningJobExecutions.workspaceId, runningJobExecutions.workspaceId),
                  eq(newerRunningJobExecutions.provisionerId, runningJobExecutions.provisionerId),
                  eq(
                    newerRunningJobExecutions.providerRunnerId,
                    runningJobExecutions.providerRunnerId,
                  ),
                  or(
                    gt(newerRunningJobExecutions.startedAt, runningJobExecutions.startedAt),
                    and(
                      eq(newerRunningJobExecutions.startedAt, runningJobExecutions.startedAt),
                      gt(
                        newerRunningJobExecutions.jobExecutionId,
                        runningJobExecutions.jobExecutionId,
                      ),
                    ),
                  ),
                ),
              ),
          ),
        ),
      ),
  );
  const activationTimeout = and(
    eq(providerRunners.launchKind, 'demand'),
    isNull(providerRunners.runnerSessionId),
    lt(
      providerRunners.createdAt,
      sql`now() - (${config.RUNNER_DEMAND_ACTIVATION_TIMEOUT_SECONDS} || ' seconds')::interval`,
    ),
    notExists(
      tx
        .select({id: reservations.id})
        .from(reservations)
        .where(
          and(
            or(
              eq(reservations.id, providerRunners.reservationId),
              eq(reservations.id, providerRunners.intendedReservationId),
            ),
            eq(reservations.workspaceId, params.workspaceId),
            eq(reservations.provisionerId, params.provisionerId),
            gt(reservations.expiresAt, sql`now()`),
          ),
        ),
    ),
  );

  return tx
    .select({
      providerRunnerId: providerRunners.providerRunnerId,
      activationTimeoutRetry: sql<boolean>`${providerRunners.reservationReleasedAt} is not null`,
      reason: sql<RunnerInstanceTerminateIntentReason>`case
        when ${activationTimeout} then 'activation-timeout'
        else 'job-cancelled'
      end`,
    })
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.workspaceId, params.workspaceId),
        eq(providerRunners.provisionerId, params.provisionerId),
        isNotNull(providerRunners.providerRunnerId),
        inArray(providerRunners.state, activeStates),
        params.providerRunnerIds && params.providerRunnerIds.length > 0
          ? inArray(providerRunners.providerRunnerId, params.providerRunnerIds)
          : undefined,
        params.providerRunnerIdAfter
          ? gt(providerRunners.providerRunnerId, params.providerRunnerIdAfter)
          : undefined,
        or(latestCancelledJob, activationTimeout),
      ),
    );
}

async function listTerminateIntentsHonoredByTerminatedReportsTx(
  tx: Tx,
  params: ReportRunnerInstancesParams,
  events: RunnerInstanceReportEvent[],
): Promise<HonoredRunnerInstanceTerminateIntent[]> {
  const terminatedRunnerInstanceIds = [
    ...new Set(
      events.filter((event) => event.state === 'terminated').map((event) => event.providerRunnerId),
    ),
  ];
  if (terminatedRunnerInstanceIds.length === 0) return [];

  const authorizedRows = await tx
    .select({
      providerRunnerId: providerRunners.providerRunnerId,
      reason: providerRunners.terminationReason,
      state: providerRunners.state,
      reportedAt: providerRunners.reportedAt,
      terminationAuthorizedAt: providerRunners.terminationAuthorizedAt,
    })
    .from(providerRunners)
    .where(
      and(
        params.workspaceId
          ? eq(providerRunners.workspaceId, params.workspaceId)
          : isNull(providerRunners.workspaceId),
        eq(providerRunners.provisionerId, params.provisionerId),
        inArray(providerRunners.providerRunnerId, terminatedRunnerInstanceIds),
        isNotNull(providerRunners.terminationAuthorizedAt),
        isNotNull(providerRunners.terminationReason),
      ),
    );
  const terminalEventReportedAtByRunnerId = new Map(
    events
      .filter((event) => event.state === 'terminated')
      .map((event) => [event.providerRunnerId, event.reportedAt]),
  );
  const honoredByRunnerId = new Map<string, HonoredRunnerInstanceTerminateIntent>(
    authorizedRows.flatMap((row) => {
      const eventReportedAt = row.providerRunnerId
        ? terminalEventReportedAtByRunnerId.get(row.providerRunnerId)
        : undefined;
      const isNewTerminationReport =
        eventReportedAt !== undefined &&
        (row.state !== 'terminated'
          ? eventReportedAt >= row.reportedAt
          : eventReportedAt > row.reportedAt) &&
        row.terminationAuthorizedAt !== null &&
        (row.state !== 'terminated' || row.terminationAuthorizedAt > row.reportedAt);
      return row.providerRunnerId && row.reason && isNewTerminationReport
        ? [
            [
              row.providerRunnerId,
              {
                providerRunnerId: row.providerRunnerId,
                reason: row.reason,
                origin: 'durable' as const,
              },
            ],
          ]
        : [];
    }),
  );

  // Keep recognizing direct legacy cancellation intents until graceful cleanup moves them onto
  // the durable authorization path. A canonical authorization always wins for the same runner.
  if (params.workspaceId) {
    const legacyRows = await provisionerTerminateIntentsQuery(tx, {
      workspaceId: params.workspaceId,
      provisionerId: params.provisionerId,
      providerRunnerIds: terminatedRunnerInstanceIds,
    }).orderBy(asc(providerRunners.providerRunnerId));
    for (const row of legacyRows) {
      const intent = toRunnerInstanceTerminateIntent(row)[0];
      if (intent && !honoredByRunnerId.has(intent.providerRunnerId))
        honoredByRunnerId.set(intent.providerRunnerId, {...intent, origin: 'legacy'});
    }
  }

  return [...honoredByRunnerId.values()];
}

export async function reconcileRunnerInstances(
  params: ReconcileRunnerInstancesParams,
): Promise<ReconcileRunnerInstancesDbResult> {
  const observedRunnerInstanceIds = [...new Set(params.observedRunnerInstanceIds)];

  return await db().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${params.workspaceId ?? params.provisionerId}))`,
    );

    const {absentIds, reservationsReleased} = await reconcileAbsentRunnerInstancesTx(
      tx,
      params,
      observedRunnerInstanceIds,
    );

    await authorizeExhaustedEphemeralSessionsTx(tx, params, observedRunnerInstanceIds);

    const observedRows =
      observedRunnerInstanceIds.length === 0
        ? []
        : (
            await tx
              .select()
              .from(providerRunners)
              .where(
                and(
                  params.workspaceId
                    ? eq(providerRunners.workspaceId, params.workspaceId)
                    : isNull(providerRunners.workspaceId),
                  eq(providerRunners.provisionerId, params.provisionerId),
                  inArray(providerRunners.providerRunnerId, observedRunnerInstanceIds),
                ),
              )
          ).map(toRunnerInstance);

    const boundJobExecutions = params.workspaceId
      ? await listRunningJobExecutionsByRunnerInstanceTx(tx, {
          workspaceId: params.workspaceId,
          provisionerId: params.provisionerId,
          providerRunnerIds: observedRunnerInstanceIds,
        })
      : [];

    return {
      observedRows,
      boundJobExecutionsByRunnerInstanceId: new Map(
        boundJobExecutions.map((jobExecution) => [jobExecution.providerRunnerId, jobExecution]),
      ),
      absentIds,
      reservationsReleased,
    };
  });
}

async function authorizeExhaustedEphemeralSessionsTx(
  tx: Tx,
  params: ReconcileRunnerInstancesParams,
  observedRunnerInstanceIds: string[],
): Promise<void> {
  const terminationReasonResolver = params.terminationReasonResolver;
  if (
    !params.workspaceId ||
    !terminationReasonResolver ||
    observedRunnerInstanceIds.length === 0
  )
    return;

  const candidates = await tx
    .select({
      runnerInstanceId: providerRunners.id,
      runnerSessionId: runnerSessions.id,
      providerRunnerId: providerRunners.providerRunnerId,
    })
    .from(providerRunners)
    .innerJoin(
      runnerSessions,
      and(
        eq(runnerSessions.workspaceId, providerRunners.workspaceId),
        eq(runnerSessions.provisionerId, providerRunners.provisionerId),
        sql`${runnerSessions.providerRunnerId} = ${providerRunners.providerRunnerId}`,
      ),
    )
    .where(
      and(
        eq(providerRunners.workspaceId, params.workspaceId),
        eq(providerRunners.provisionerId, params.provisionerId),
        inArray(providerRunners.providerRunnerId, observedRunnerInstanceIds),
        inArray(providerRunners.state, activeStates),
        inArray(runnerSessions.registrationTokenKind, ['ephemeral', 'activation']),
        eq(runnerSessions.maxClaims, 1),
        sql`${runnerSessions.claimsUsed} >= ${runnerSessions.maxClaims}`,
        lt(
          sql`coalesce(${runnerSessions.lastJobCompletedAt}, ${runnerSessions.updatedAt})`,
          sql`now() - (${params.postJobExitGraceSeconds ?? config.RUNNER_POST_JOB_EXIT_GRACE_SECONDS} || ' seconds')::interval`,
        ),
      ),
    )
    .orderBy(asc(providerRunners.id));

  for (const candidate of candidates) {
    const providerRunnerId = candidate.providerRunnerId;
    if (!providerRunnerId) continue;

    await lockRunnerActivationAdvisoryKeyTx(tx, candidate.runnerInstanceId);

    const [session] = await tx
      .select({id: runnerSessions.id})
      .from(runnerSessions)
      .where(
        and(
          eq(runnerSessions.id, candidate.runnerSessionId),
          eq(runnerSessions.workspaceId, params.workspaceId),
          eq(runnerSessions.provisionerId, params.provisionerId),
          eq(runnerSessions.providerRunnerId, providerRunnerId),
          inArray(runnerSessions.registrationTokenKind, ['ephemeral', 'activation']),
          eq(runnerSessions.maxClaims, 1),
          sql`${runnerSessions.claimsUsed} >= ${runnerSessions.maxClaims}`,
          lt(
            sql`coalesce(${runnerSessions.lastJobCompletedAt}, ${runnerSessions.updatedAt})`,
            sql`now() - (${params.postJobExitGraceSeconds ?? config.RUNNER_POST_JOB_EXIT_GRACE_SECONDS} || ' seconds')::interval`,
          ),
        ),
      )
      .limit(1)
      .for('update');
    if (!session) continue;

    const [runner] = await tx
      .select({id: providerRunners.id})
      .from(providerRunners)
      .where(
        and(
          eq(providerRunners.id, candidate.runnerInstanceId),
          eq(providerRunners.workspaceId, params.workspaceId),
          eq(providerRunners.provisionerId, params.provisionerId),
          eq(providerRunners.providerRunnerId, providerRunnerId),
          inArray(providerRunners.state, activeStates),
        ),
      )
      .limit(1)
      .for('update');
    if (!runner) continue;

    const [liveJob] = await tx
      .select({id: runningJobExecutions.id})
      .from(runningJobExecutions)
      .where(
        and(
          eq(runningJobExecutions.workspaceId, params.workspaceId),
          eq(runningJobExecutions.runnerSessionId, session.id),
        ),
      )
      .limit(1);
    if (liveJob) continue;

    await persistRunnerTerminationAuthorizationTx(tx, {
      provisionerId: params.provisionerId,
      providerRunnerId,
      reason: 'session-exhausted',
      resolveTerminationReason: (reason) =>
        terminationReasonResolver({
          provisionerId: params.provisionerId,
          providerRunnerId,
          reason,
        }),
    });
  }
}

async function lockRunnerActivationAdvisoryKeyTx(tx: Tx, runnerInstanceId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`runners_activation:${runnerInstanceId}`}))`,
  );
}

async function reconcileAbsentRunnerInstancesTx(
  tx: Tx,
  params: ReconcileRunnerInstancesParams,
  observedRunnerInstanceIds: string[],
): Promise<{absentIds: string[]; reservationsReleased: number}> {
  if (observedRunnerInstanceIds.length === 0) return {absentIds: [], reservationsReleased: 0};
  const staleAbsentRows = await tx
    .select({id: providerRunners.id})
    .from(providerRunners)
    .where(
      and(
        params.workspaceId
          ? eq(providerRunners.workspaceId, params.workspaceId)
          : isNull(providerRunners.workspaceId),
        eq(providerRunners.provisionerId, params.provisionerId),
        inArray(providerRunners.state, activeStates),
        lt(
          providerRunners.reportedAt,
          sql`now() - (${params.terminateGraceSeconds} || ' seconds')::interval`,
        ),
        notInArray(providerRunners.providerRunnerId, observedRunnerInstanceIds),
      ),
    );
  if (staleAbsentRows.length === 0) return {absentIds: [], reservationsReleased: 0};
  const updated = await tx
    .update(providerRunners)
    .set({
      state: 'terminated',
      terminatedAt: sql`coalesce(${providerRunners.terminatedAt}, now())`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        inArray(
          providerRunners.id,
          staleAbsentRows.map((row) => row.id),
        ),
        inArray(providerRunners.state, activeStates),
        lt(
          providerRunners.reportedAt,
          sql`now() - (${params.terminateGraceSeconds} || ' seconds')::interval`,
        ),
      ),
    )
    .returning({id: providerRunners.id, providerRunnerId: providerRunners.providerRunnerId});
  const reservationsReleased = await releaseTerminalRunnerInstanceReservationsByIds(tx, {
    workspaceId: params.workspaceId,
    provisionerId: params.provisionerId,
    runnerInstanceIds: updated.map((row) => row.id),
    requireUnlinkedSession: false,
  });
  return {
    absentIds: updated.flatMap((row) => (row.providerRunnerId ? [row.providerRunnerId] : [])),
    reservationsReleased,
  };
}

export async function reapStaleRunnerInstances(params: {
  thresholdSeconds: number;
  limit: number;
}): Promise<ReapStaleRunnerInstancesResult> {
  const cutoff = staleRunnerInstanceCutoff(params.thresholdSeconds);

  return await db().transaction(async (tx) => {
    const candidateRows = await tx
      .select({
        id: providerRunners.id,
        workspaceId: providerRunners.workspaceId,
        provisionerId: providerRunners.provisionerId,
        providerRunnerId: providerRunners.providerRunnerId,
      })
      .from(providerRunners)
      .where(staleRunnerInstanceWhere(tx, cutoff))
      .orderBy(asc(providerRunners.updatedAt), asc(providerRunners.id))
      .limit(params.limit);

    const terminalReservationRows =
      candidateRows.length === 0
        ? await tx
            .select({
              id: providerRunners.id,
              workspaceId: providerRunners.workspaceId,
              provisionerId: providerRunners.provisionerId,
              providerRunnerId: providerRunners.providerRunnerId,
            })
            .from(providerRunners)
            .where(
              and(
                inArray(providerRunners.state, terminalStates),
                isNotNull(providerRunners.runnerSessionId),
                lt(providerRunners.updatedAt, cutoff),
                isNull(providerRunners.reservationReleasedAt),
                or(
                  isNotNull(providerRunners.reservationId),
                  isNotNull(providerRunners.intendedReservationId),
                ),
              ),
            )
            .orderBy(asc(providerRunners.updatedAt), asc(providerRunners.id))
            .limit(params.limit)
        : [];

    if (candidateRows.length === 0 && terminalReservationRows.length === 0)
      return {reaped: 0, reservationsReleased: 0};

    const workspaceIds = [
      ...new Set(
        [...candidateRows, ...terminalReservationRows].flatMap((row) =>
          row.workspaceId ? [row.workspaceId] : [],
        ),
      ),
    ].sort();
    for (const workspaceId of workspaceIds) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
    }

    const updatedRows = await tx
      .update(providerRunners)
      .set({
        state: 'failed',
        reason: 'stale-provisioner',
        failedAt: sql`coalesce(${providerRunners.failedAt}, now())`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          inArray(
            providerRunners.id,
            candidateRows.map((row) => row.id),
          ),
          staleRunnerInstanceWhere(tx, cutoff),
        ),
      )
      .returning({
        id: providerRunners.id,
        workspaceId: providerRunners.workspaceId,
        provisionerId: providerRunners.provisionerId,
        providerRunnerId: providerRunners.providerRunnerId,
      });

    let reservationsReleased = 0;
    for (const group of groupRunnerInstanceIds(updatedRows)) {
      reservationsReleased += await releaseTerminalRunnerInstanceReservationsByIds(tx, {
        workspaceId: group.workspaceId,
        provisionerId: group.provisionerId,
        runnerInstanceIds: group.runnerInstanceIds,
        requireUnlinkedSession: false,
      });
    }
    for (const group of groupRunnerInstanceIds(terminalReservationRows)) {
      reservationsReleased += await releaseTerminalRunnerInstanceReservationsByIds(tx, {
        workspaceId: group.workspaceId,
        provisionerId: group.provisionerId,
        runnerInstanceIds: group.runnerInstanceIds,
        requireUnlinkedSession: false,
      });
    }

    return {reaped: updatedRows.length, reservationsReleased};
  });
}

async function releaseTerminalRunnerInstanceReservations(
  tx: Tx,
  params: ReportRunnerInstancesParams,
  events: RunnerInstanceReportEvent[],
): Promise<number> {
  const terminalEvents = events.filter((event) => isTerminalState(event.state));
  if (terminalEvents.length === 0) return 0;

  return await releaseTerminalRunnerInstanceReservationsByIds(tx, {
    workspaceId: params.workspaceId,
    provisionerId: params.provisionerId,
    providerRunnerIds: terminalEvents.map((event) => event.providerRunnerId),
    reportedAtByProviderRunnerId: new Map(
      terminalEvents.map((event) => [event.providerRunnerId, event.reportedAt]),
    ),
    requireUnlinkedSession: false,
  });
}

function staleRunnerInstanceCutoff(thresholdSeconds: number): SQL {
  return sql`now() - (${thresholdSeconds} || ' seconds')::interval`;
}

function staleRunnerInstanceWhere(tx: Tx, cutoff: SQL): SQL<boolean> {
  return and(
    inArray(providerRunners.state, activeStates),
    lt(providerRunners.reportedAt, cutoff),
    lt(providerRunners.updatedAt, cutoff),
    exists(
      tx
        .select({id: provisionerTokens.id})
        .from(provisionerTokens)
        .where(
          and(
            eq(provisionerTokens.id, providerRunners.provisionerId),
            or(isNull(provisionerTokens.lastSeenAt), lt(provisionerTokens.lastSeenAt, cutoff)),
          ),
        ),
    ),
    notExists(
      tx
        .select({id: runningJobExecutions.id})
        .from(runningJobExecutions)
        .where(
          and(
            eq(runningJobExecutions.workspaceId, providerRunners.workspaceId),
            eq(runningJobExecutions.provisionerId, providerRunners.provisionerId),
            eq(runningJobExecutions.providerRunnerId, providerRunners.providerRunnerId),
          ),
        ),
    ),
    notExists(
      tx
        .select({id: runnerSessions.id})
        .from(runnerSessions)
        .where(
          and(
            eq(runnerSessions.workspaceId, providerRunners.workspaceId),
            eq(runnerSessions.provisionerId, providerRunners.provisionerId),
            eq(runnerSessions.providerRunnerId, providerRunners.providerRunnerId),
            sql`${runnerSessions.updatedAt} >= ${cutoff}`,
          ),
        ),
    ),
  ) as SQL<boolean>;
}

function groupRunnerInstanceIds(
  rows: Array<{
    id: string;
    workspaceId: string | null;
    provisionerId: string;
    providerRunnerId: string | null;
  }>,
): Array<{
  workspaceId: string | null;
  provisionerId: string;
  runnerInstanceIds: string[];
}> {
  const groups = new Map<
    string,
    {workspaceId: string | null; provisionerId: string; runnerInstanceIds: string[]}
  >();
  for (const row of rows) {
    const key = `${row.workspaceId ?? ''}:${row.provisionerId}`;
    const group = groups.get(key) ?? {
      workspaceId: row.workspaceId,
      provisionerId: row.provisionerId,
      runnerInstanceIds: [],
    };
    group.runnerInstanceIds.push(row.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function aggregateEvents(
  events: RunnerInstanceReportEvent[],
  receivedAt: Date,
): RunnerInstanceReportRow[] {
  const byRunnerInstanceId = new Map<string, RunnerInstanceReportRow>();
  for (const rawEvent of events) {
    const event = toRunnerInstanceReportRow(rawEvent, receivedAt);
    const existing = byRunnerInstanceId.get(event.providerRunnerId);
    if (existing) mergeMilestones(existing, event);
    if (!existing || compareRunnerInstanceReportEvents(event, existing) > 0) {
      byRunnerInstanceId.set(
        event.providerRunnerId,
        existing ? mergeProjectionMetadata(event, existing) : event,
      );
    }
  }
  return [...byRunnerInstanceId.values()];
}

function toRunnerInstanceReportRow(
  event: RunnerInstanceReportEvent,
  receivedAt: Date,
): RunnerInstanceReportRow {
  const reportedAt = event.reportedAt > receivedAt ? receivedAt : event.reportedAt;
  return {
    ...event,
    reportedAt,
    startedAt: event.state === 'running' ? reportedAt : null,
    stoppingAt: event.state === 'stopping' ? reportedAt : null,
    stoppedAt: event.state === 'stopped' ? reportedAt : null,
    failedAt: event.state === 'failed' ? reportedAt : null,
    terminatedAt: event.state === 'terminated' ? reportedAt : null,
  };
}

function mergeMilestones(target: RunnerInstanceReportRow, source: RunnerInstanceReportRow) {
  target.startedAt = earliestDate(target.startedAt, source.startedAt);
  target.stoppingAt = earliestDate(target.stoppingAt, source.stoppingAt);
  target.stoppedAt = earliestDate(target.stoppedAt, source.stoppedAt);
  target.failedAt = earliestDate(target.failedAt, source.failedAt);
  target.terminatedAt = earliestDate(target.terminatedAt, source.terminatedAt);
}

function mergeProjectionMetadata(
  event: RunnerInstanceReportRow,
  existing: RunnerInstanceReportRow,
): RunnerInstanceReportRow {
  return {
    ...event,
    reservationId: event.reservationId ?? existing.reservationId,
    templateKey: event.templateKey ?? existing.templateKey,
    runnerSessionId: event.runnerSessionId ?? existing.runnerSessionId,
    providerKind: event.providerKind ?? existing.providerKind,
    ...pickMilestones(existing),
  };
}

function pickMilestones(event: RunnerInstanceReportRow) {
  return {
    startedAt: event.startedAt,
    stoppingAt: event.stoppingAt,
    stoppedAt: event.stoppedAt,
    failedAt: event.failedAt,
    terminatedAt: event.terminatedAt,
  };
}

function earliestDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function compareRunnerInstanceReportEvents(
  a: RunnerInstanceReportEvent,
  b: RunnerInstanceReportEvent,
): number {
  const timeDelta = a.reportedAt.getTime() - b.reportedAt.getTime();
  const rankDelta = getRunnerInstanceStateRank(a.state) - getRunnerInstanceStateRank(b.state);
  if (rankDelta !== 0) return rankDelta;
  return timeDelta;
}

function getRunnerInstanceStateRank(state: RunnerInstanceState): number {
  switch (state) {
    case 'starting':
      return 1;
    case 'running':
      return 2;
    case 'stopping':
      return 3;
    case 'stopped':
      return 4;
    case 'failed':
      return 5;
    case 'terminated':
      return 6;
  }
}

function providerRunnerStateRank(state: SQL | typeof providerRunners.state): SQL<number> {
  return sql<number>`
    CASE ${state}
      WHEN 'starting' THEN 1
      WHEN 'running' THEN 2
      WHEN 'stopping' THEN 3
      WHEN 'stopped' THEN 4
      WHEN 'failed' THEN 5
      WHEN 'terminated' THEN 6
      ELSE 0
    END
  `;
}

function providerRunnerProjectionUpdateCondition(): SQL<boolean> {
  return sql<boolean>`
    ${providerRunnerStateRank(sql`excluded.state`)} > ${providerRunnerStateRank(providerRunners.state)}
    OR (
      ${providerRunnerStateRank(sql`excluded.state`)} = ${providerRunnerStateRank(providerRunners.state)}
      AND excluded.reported_at >= ${providerRunners.reportedAt}
    )
  `;
}

function providerRunnerMilestoneUpdateCondition(): SQL<boolean> {
  return sql<boolean>`
    ${milestoneNeedsUpdate(providerRunners.startedAt, sql`excluded.started_at`)}
    OR ${milestoneNeedsUpdate(providerRunners.stoppingAt, sql`excluded.stopping_at`)}
    OR ${milestoneNeedsUpdate(providerRunners.stoppedAt, sql`excluded.stopped_at`)}
    OR ${milestoneNeedsUpdate(providerRunners.failedAt, sql`excluded.failed_at`)}
    OR ${milestoneNeedsUpdate(providerRunners.terminatedAt, sql`excluded.terminated_at`)}
  `;
}

function milestoneNeedsUpdate(
  current: SQL | RunnerInstanceMilestoneColumn,
  incoming: SQL,
): SQL<boolean> {
  return sql<boolean>`${incoming} IS NOT NULL AND (${current} IS NULL OR ${incoming} < ${current})`;
}

function firstObservedAt(current: SQL | RunnerInstanceMilestoneColumn, incoming: SQL) {
  return sql`
    CASE
      WHEN ${incoming} IS NULL THEN ${current}
      WHEN ${current} IS NULL THEN ${incoming}
      ELSE least(${current}, ${incoming})
    END
  `;
}

export function isTerminalState(state: RunnerInstanceState): boolean {
  return terminalStates.includes(state as (typeof terminalStates)[number]);
}

function isDivergenceCountState(
  state: RunnerInstanceState,
): state is (typeof divergenceCountStates)[number] {
  return divergenceCountStates.includes(state as (typeof divergenceCountStates)[number]);
}
