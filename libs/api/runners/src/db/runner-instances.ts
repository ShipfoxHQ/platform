import {logger} from '@shipfox/node-opentelemetry';
import {canonicalizeLabels} from '@shipfox/runner-labels';
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
import type {RunnerInstance, RunnerInstanceState} from '#core/entities/runner-instance.js';
import type {Tx} from './db.js';
import {db} from './db.js';
import {
  listRunningJobExecutionsByRunnerInstanceTx,
  type RunnerInstanceBoundJobExecution,
} from './job-executions.js';
import {releaseReservationUnits} from './reservations.js';
import {ephemeralRegistrationTokens} from './schema/ephemeral-registration-tokens.js';
import {provisionerTokens} from './schema/provisioner-tokens.js';
import {reservations} from './schema/reservations.js';
import {providerRunners, toRunnerInstance} from './schema/runner-instances.js';
import {runnerSessions} from './schema/runner-sessions.js';
import {runningJobExecutions} from './schema/running-job-executions.js';

export const terminalStates = [
  'stopped',
  'failed',
  'terminated',
] as const satisfies readonly RunnerInstanceState[];
export const activeStates = [
  'starting',
  'running',
  'stopping',
] as const satisfies readonly RunnerInstanceState[];
export const divergenceCountStates = ['starting', 'running'] as const satisfies readonly Extract<
  RunnerInstanceState,
  'starting' | 'running'
>[];

export type RunnerInstanceTerminateIntentReason = 'job-cancelled';

export interface RunnerInstanceTerminateIntent {
  providerRunnerId: string;
  reason: RunnerInstanceTerminateIntentReason;
}

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
  workspaceId: string | null;
  provisionerId: string;
  events: RunnerInstanceReportEvent[];
}

export interface ReconcileRunnerInstancesParams {
  workspaceId: string | null;
  provisionerId: string;
  observedRunnerInstanceIds: string[];
  terminateGraceSeconds: number;
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
  terminateIntentsHonored: RunnerInstanceTerminateIntent[];
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

    const events = await hydrateRunnerSessionIdsFromConsumedTokens(tx, params, aggregatedEvents);
    const terminateIntentsHonored = await listTerminateIntentsHonoredByTerminatedReportsTx(
      tx,
      params,
      events,
    );

    const values = events.map((event) => ({
      workspaceId: params.workspaceId,
      provisionerId: params.provisionerId,
      providerRunnerId: event.providerRunnerId,
      reservationId: event.reservationId,
      templateKey: event.templateKey,
      labels: [...canonicalizeLabels(event.labels)],
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
          reservationId: sql`CASE WHEN ${providerRunnerProjectionUpdateCondition()} THEN coalesce(excluded.reservation_id, ${providerRunners.reservationId}) ELSE ${providerRunners.reservationId} END`,
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

    const reservationsReleased = hasTerminalEvent
      ? await releaseTerminalRunnerInstanceReservations(tx, params, events)
      : 0;

    return {accepted: events.length, reservationsReleased, terminateIntentsHonored};
  });
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

export async function listProvisionerTerminateIntentRowsTx(
  tx: Tx,
  params: {
    workspaceId: string;
    provisionerId: string;
    limit: number;
  },
): Promise<RunnerInstanceTerminateIntent[]> {
  const rows = await provisionerTerminateIntentsQuery(tx, params)
    .orderBy(asc(providerRunners.providerRunnerId))
    .limit(params.limit + 1);

  const truncated = rows.length > params.limit;
  const returnedRows = truncated ? rows.slice(0, params.limit) : rows;
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

  return returnedRows.flatMap((row) =>
    row.providerRunnerId ? [{...row, providerRunnerId: row.providerRunnerId}] : [],
  );
}

function provisionerTerminateIntentsQuery(
  tx: Tx,
  params: {workspaceId: string; provisionerId: string; providerRunnerIds?: string[]},
) {
  const newerRunningJobExecutions = alias(runningJobExecutions, 'newer_running_jobs');

  return tx
    .select({
      providerRunnerId: providerRunners.providerRunnerId,
      reason: sql<RunnerInstanceTerminateIntentReason>`'job-cancelled'`,
    })
    .from(runningJobExecutions)
    .innerJoin(
      providerRunners,
      and(
        eq(providerRunners.workspaceId, runningJobExecutions.workspaceId),
        eq(providerRunners.provisionerId, runningJobExecutions.provisionerId),
        eq(providerRunners.providerRunnerId, runningJobExecutions.providerRunnerId),
      ),
    )
    .where(
      and(
        eq(runningJobExecutions.workspaceId, params.workspaceId),
        eq(runningJobExecutions.provisionerId, params.provisionerId),
        isNotNull(providerRunners.providerRunnerId),
        isNotNull(runningJobExecutions.cancellationRequestedAt),
        inArray(providerRunners.state, activeStates),
        params.providerRunnerIds && params.providerRunnerIds.length > 0
          ? inArray(providerRunners.providerRunnerId, params.providerRunnerIds)
          : undefined,
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
    )
    .groupBy(providerRunners.providerRunnerId);
}

async function listTerminateIntentsHonoredByTerminatedReportsTx(
  tx: Tx,
  params: ReportRunnerInstancesParams,
  events: RunnerInstanceReportEvent[],
): Promise<RunnerInstanceTerminateIntent[]> {
  if (!params.workspaceId) return [];
  const terminatedRunnerInstanceIds = [
    ...new Set(
      events.filter((event) => event.state === 'terminated').map((event) => event.providerRunnerId),
    ),
  ];
  if (terminatedRunnerInstanceIds.length === 0) return [];

  const rows = await provisionerTerminateIntentsQuery(tx, {
    workspaceId: params.workspaceId,
    provisionerId: params.provisionerId,
    providerRunnerIds: terminatedRunnerInstanceIds,
  }).orderBy(asc(providerRunners.providerRunnerId));
  return rows.flatMap((row) =>
    row.providerRunnerId ? [{...row, providerRunnerId: row.providerRunnerId}] : [],
  );
}

export async function reconcileRunnerInstances(
  params: ReconcileRunnerInstancesParams,
): Promise<ReconcileRunnerInstancesDbResult> {
  const observedRunnerInstanceIds = [...new Set(params.observedRunnerInstanceIds)];

  return await db().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${params.workspaceId ?? params.provisionerId}))`,
    );

    let absentIds: string[] = [];
    let reservationsReleased = 0;
    if (observedRunnerInstanceIds.length > 0) {
      const staleAbsentRows = await tx
        .select({
          id: providerRunners.id,
          providerRunnerId: providerRunners.providerRunnerId,
        })
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

      if (staleAbsentRows.length > 0) {
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
          .returning({providerRunnerId: providerRunners.providerRunnerId});

        absentIds = updated.flatMap((row) => (row.providerRunnerId ? [row.providerRunnerId] : []));
        if (params.workspaceId) {
          reservationsReleased = await releaseTerminalRunnerInstanceReservationsByIds(tx, {
            workspaceId: params.workspaceId,
            provisionerId: params.provisionerId,
            providerRunnerIds: absentIds,
          });
        }
      }
    }

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

    if (candidateRows.length === 0) return {reaped: 0, reservationsReleased: 0};

    const workspaceIds = [
      ...new Set(candidateRows.flatMap((row) => (row.workspaceId ? [row.workspaceId] : []))),
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
        workspaceId: providerRunners.workspaceId,
        provisionerId: providerRunners.provisionerId,
        providerRunnerId: providerRunners.providerRunnerId,
      });

    let reservationsReleased = 0;
    for (const group of groupRunnerInstanceIds(updatedRows)) {
      reservationsReleased += await releaseTerminalRunnerInstanceReservationsByIds(tx, {
        workspaceId: group.workspaceId,
        provisionerId: group.provisionerId,
        providerRunnerIds: group.providerRunnerIds,
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
  });
}

async function releaseTerminalRunnerInstanceReservationsByIds(
  tx: Tx,
  params: {
    workspaceId: string | null;
    provisionerId: string;
    providerRunnerIds: string[];
    requireUnlinkedSession?: boolean;
  },
): Promise<number> {
  if (params.providerRunnerIds.length === 0) return 0;

  const rows = await tx
    .select({
      id: providerRunners.id,
      reservationId: providerRunners.reservationId,
      intendedReservationId: providerRunners.intendedReservationId,
      reservationWorkspaceId: sql<string | null>`coalesce(
        (select ${reservations.workspaceId}
         from ${reservations}
         where ${reservations.id} = ${providerRunners.reservationId}
           and ${reservations.provisionerId} = ${params.provisionerId}),
        (select ${reservations.workspaceId}
         from ${reservations}
         where ${reservations.id} = ${providerRunners.intendedReservationId}
           and ${reservations.provisionerId} = ${params.provisionerId})
      )`,
    })
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.provisionerId, params.provisionerId),
        inArray(providerRunners.providerRunnerId, params.providerRunnerIds),
        inArray(providerRunners.state, terminalStates),
        or(
          isNotNull(providerRunners.reservationId),
          isNotNull(providerRunners.intendedReservationId),
        ),
        params.workspaceId === null
          ? undefined
          : or(
              and(
                eq(providerRunners.workspaceId, params.workspaceId),
                or(
                  exists(
                    tx
                      .select({id: reservations.id})
                      .from(reservations)
                      .where(
                        and(
                          eq(reservations.workspaceId, params.workspaceId),
                          eq(reservations.provisionerId, params.provisionerId),
                          eq(reservations.id, providerRunners.reservationId),
                        ),
                      ),
                  ),
                  exists(
                    tx
                      .select({id: reservations.id})
                      .from(reservations)
                      .where(
                        and(
                          eq(reservations.workspaceId, params.workspaceId),
                          eq(reservations.provisionerId, params.provisionerId),
                          eq(reservations.id, providerRunners.intendedReservationId),
                        ),
                      ),
                  ),
                ),
              ),
              and(
                isNull(providerRunners.workspaceId),
                isNotNull(providerRunners.intendedReservationId),
                exists(
                  tx
                    .select({id: reservations.id})
                    .from(reservations)
                    .where(
                      and(
                        eq(reservations.workspaceId, params.workspaceId),
                        eq(reservations.provisionerId, params.provisionerId),
                        eq(reservations.id, providerRunners.intendedReservationId),
                      ),
                    ),
                ),
              ),
            ),
        params.requireUnlinkedSession === false
          ? undefined
          : isNull(providerRunners.runnerSessionId),
        isNull(providerRunners.reservationReleasedAt),
      ),
    )
    .for('update');

  if (rows.length === 0) return 0;

  const updated = await tx
    .update(providerRunners)
    .set({
      intendedReservationId: null,
      reservationReleasedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        inArray(
          providerRunners.id,
          rows.map((row) => row.id),
        ),
        params.requireUnlinkedSession === false
          ? undefined
          : isNull(providerRunners.runnerSessionId),
        isNull(providerRunners.reservationReleasedAt),
      ),
    )
    .returning({id: providerRunners.id});

  const releasesByReservationId = new Map<
    string,
    {workspaceId: string; reservationId: string; count: number}
  >();
  const updatedIds = new Set(updated.map((row) => row.id));
  for (const row of rows) {
    if (!updatedIds.has(row.id)) continue;
    const reservationId = row.reservationId ?? row.intendedReservationId;
    if (!reservationId || !row.reservationWorkspaceId) continue;
    const key = `${row.reservationWorkspaceId}:${reservationId}`;
    const release = releasesByReservationId.get(key) ?? {
      workspaceId: row.reservationWorkspaceId,
      reservationId,
      count: 0,
    };
    release.count += 1;
    releasesByReservationId.set(key, release);
  }

  if (releasesByReservationId.size === 0) return 0;

  let released = 0;
  for (const release of releasesByReservationId.values()) {
    released += await releaseReservationUnits(tx, {
      workspaceId: release.workspaceId,
      provisionerId: params.provisionerId,
      releases: [{reservationId: release.reservationId, count: release.count}],
    });
  }
  return released;
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
    workspaceId: string | null;
    provisionerId: string;
    providerRunnerId: string | null;
  }>,
): Array<{workspaceId: string | null; provisionerId: string; providerRunnerIds: string[]}> {
  const groups = new Map<
    string,
    {workspaceId: string | null; provisionerId: string; providerRunnerIds: string[]}
  >();
  for (const row of rows) {
    if (!row.providerRunnerId) continue;
    const key = `${row.workspaceId ?? ''}:${row.provisionerId}`;
    const group = groups.get(key) ?? {
      workspaceId: row.workspaceId,
      provisionerId: row.provisionerId,
      providerRunnerIds: [],
    };
    group.providerRunnerIds.push(row.providerRunnerId);
    groups.set(key, group);
  }
  return [...groups.values()];
}

async function hydrateRunnerSessionIdsFromConsumedTokens(
  tx: Tx,
  params: ReportRunnerInstancesParams,
  events: RunnerInstanceReportRow[],
): Promise<RunnerInstanceReportRow[]> {
  if (!params.workspaceId) return events;
  const providerRunnerIds = [...new Set(events.map((event) => event.providerRunnerId))];
  if (providerRunnerIds.length === 0) return events;

  const tokenRows = await tx
    .select({
      providerRunnerId: ephemeralRegistrationTokens.providerRunnerId,
      consumedSessionId: ephemeralRegistrationTokens.consumedSessionId,
    })
    .from(ephemeralRegistrationTokens)
    .where(
      and(
        eq(ephemeralRegistrationTokens.workspaceId, params.workspaceId),
        eq(ephemeralRegistrationTokens.provisionerId, params.provisionerId),
        inArray(ephemeralRegistrationTokens.providerRunnerId, providerRunnerIds),
        isNotNull(ephemeralRegistrationTokens.consumedSessionId),
      ),
    )
    .orderBy(
      desc(ephemeralRegistrationTokens.consumedAt),
      desc(ephemeralRegistrationTokens.createdAt),
    );

  const consumedSessionIdsByRunnerInstanceId = new Map<string, string>();
  for (const row of tokenRows) {
    if (!row.consumedSessionId) continue;
    if (consumedSessionIdsByRunnerInstanceId.has(row.providerRunnerId)) continue;
    consumedSessionIdsByRunnerInstanceId.set(row.providerRunnerId, row.consumedSessionId);
  }

  if (consumedSessionIdsByRunnerInstanceId.size === 0) return events;

  return events.map((event) => {
    const consumedSessionId = consumedSessionIdsByRunnerInstanceId.get(event.providerRunnerId);
    if (!consumedSessionId || event.runnerSessionId === consumedSessionId) return event;
    return {...event, runnerSessionId: consumedSessionId};
  });
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
