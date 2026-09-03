import {
  RUNNER_JOB_CLAIMED,
  RUNNER_JOB_LEASE_EXPIRED,
  type RunnerJobStopReasonDto,
  type RunnersEventMap,
  type RunnerToolCapabilitiesDto,
} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {writeOutboxEvent, writeOutboxEvents} from '@shipfox/node-outbox';
import {canonicalizeLabels} from '@shipfox/runner-labels';
import {
  and,
  arrayContained,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import {
  EmptyRequiredLabelsError,
  RunnerSessionExhaustedError,
  RunningJobExecutionNotFoundError,
} from '#core/errors.js';
import {
  type JobExecutionQueueTimeObservation,
  jobExecutionEnqueuedCount,
  jobExecutionLeaseExpiredCount,
  type ProviderRunnerLifecycleObservation,
  recordDeferredJobLeaseExpiry,
  recordJobExecutionQueueTime,
  recordProviderRunnerActivationToFirstClaim,
  recordRunnerReservationReleased,
  recordShadowedJobLeaseExpiry,
  recordStaleJobCandidateRatio,
} from '#metrics/instance.js';
import type {Tx} from './db.js';
import {db} from './db.js';
import {lockRunnerReservationAdvisoryKeysTx} from './reservation-locks.js';
import {
  releaseReservationUnits,
  releaseTerminalRunnerInstanceReservationsByIds,
} from './reservations.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobExecutions} from './schema/pending-job-executions.js';
import {reservations} from './schema/reservations.js';
import {providerRunners} from './schema/runner-instances.js';
import {runnerSessions} from './schema/runner-sessions.js';
import {runningJobExecutions} from './schema/running-job-executions.js';

const runnerJobExecutionLockPrefix = 'runners_job_execution:';
const defaultJobStopHandoffCleanupLimit = 100;

export interface JobStopHandoffCleanupResult {
  removed: number;
  reservationsReleased: number;
  removedJobExecutionIds: string[];
}

async function lockJobExecution(tx: Tx, jobExecutionId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`${runnerJobExecutionLockPrefix}${jobExecutionId}`}))`,
  );
}

async function releaseReservationsForTerminalRunningRows(
  tx: Tx,
  rows: ReadonlyArray<{
    provisionerId: string | null;
    providerRunnerId: string | null;
  }>,
): Promise<number> {
  // Converge after the lease fact changes. The reservation helper locks each provider runner
  // and releases only when the runner is terminal and no uncancelled lease remains.
  const providerRunnerIdsByProvisionerId = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.provisionerId === null || row.providerRunnerId === null) continue;
    const providerRunnerIds =
      providerRunnerIdsByProvisionerId.get(row.provisionerId) ?? new Set<string>();
    providerRunnerIds.add(row.providerRunnerId);
    providerRunnerIdsByProvisionerId.set(row.provisionerId, providerRunnerIds);
  }

  let released = 0;
  for (const provisionerId of [...providerRunnerIdsByProvisionerId.keys()].sort()) {
    const providerRunnerIds = providerRunnerIdsByProvisionerId.get(provisionerId);
    if (!providerRunnerIds) continue;
    released += await releaseTerminalRunnerInstanceReservationsByIds(tx, {
      workspaceId: null,
      provisionerId,
      providerRunnerIds: [...providerRunnerIds].sort(),
      requireUnlinkedSession: false,
      // Lock and re-check the runner row locally so lease finalization remains retryable
      // without a workflow/runner scope lock.
      requireTerminalState: false,
    });
  }
  return released;
}

function protectedJobLeasePredicate() {
  return isNull(runningJobExecutions.cancellationRequestedAt);
}

export interface JobExecutionCleanupStats {
  stopHandoffCount: number;
  stopHandoffOldestAgeMilliseconds: number;
}

/**
 * Returns bounded service-metric observations for terminal stop handoffs that still need cleanup.
 * Normal terminal rows are removed synchronously by reconciliation and therefore do not remain in
 * this population.
 */
export async function getJobExecutionCleanupStats(): Promise<JobExecutionCleanupStats> {
  const [row] = await db()
    .select({
      stopHandoffCount: sql<number>`count(*) filter (where ${isNotNull(runningJobExecutions.cancellationRequestedAt)})::int`,
      stopHandoffOldestAgeMilliseconds: sql<number>`coalesce(
        extract(epoch from (now() - min(${runningJobExecutions.cancellationRequestedAt}) filter (
          where ${isNotNull(runningJobExecutions.cancellationRequestedAt)}
        ))) * 1000,
        0
      )::double precision`,
    })
    .from(runningJobExecutions);

  return {
    stopHandoffCount: Math.max(0, Number(row?.stopHandoffCount ?? 0)),
    stopHandoffOldestAgeMilliseconds: Math.max(
      0,
      Number(row?.stopHandoffOldestAgeMilliseconds ?? 0),
    ),
  };
}

/**
 * Removes stop handoffs acknowledged by a terminal provider report. The caller owns the
 * provider-runner transaction and releases any terminal reservation after this delete.
 */
export async function removeJobStopHandoffsForTerminalProviderRunnersTx(
  tx: Tx,
  params: {
    provisionerId: string;
    providerRunnerIds: readonly string[];
  },
): Promise<number> {
  if (params.providerRunnerIds.length === 0) return 0;

  const candidates = await tx
    .select({
      id: runningJobExecutions.id,
      jobExecutionId: runningJobExecutions.jobExecutionId,
    })
    .from(runningJobExecutions)
    .where(
      and(
        eq(runningJobExecutions.provisionerId, params.provisionerId),
        inArray(runningJobExecutions.providerRunnerId, params.providerRunnerIds),
        isNotNull(runningJobExecutions.cancellationRequestedAt),
      ),
    )
    .orderBy(asc(runningJobExecutions.jobExecutionId));

  for (const candidate of candidates) await lockJobExecution(tx, candidate.jobExecutionId);

  if (candidates.length === 0) return 0;

  const deleted = await tx
    .delete(runningJobExecutions)
    .where(
      and(
        inArray(
          runningJobExecutions.id,
          candidates.map((candidate) => candidate.id),
        ),
        isNotNull(runningJobExecutions.cancellationRequestedAt),
      ),
    )
    .returning({id: runningJobExecutions.id});
  return deleted.length;
}

/**
 * Removes managed stop handoffs that outlived the bounded local cleanup grace for one provisioner
 * scope. Installation-scoped provisioners can own jobs in multiple workspaces, so the provisioner
 * identity is the only required filter when workspaceId is null.
 */
export async function removeExpiredJobStopHandoffs(params: {
  workspaceId: string | null;
  provisionerId: string;
  graceSeconds: number;
  limit?: number;
}): Promise<JobStopHandoffCleanupResult> {
  return await db().transaction((tx) =>
    removeExpiredJobStopHandoffsTx(tx, {
      graceSeconds: params.graceSeconds,
      limit: params.limit,
      where: and(
        eq(runningJobExecutions.provisionerId, params.provisionerId),
        params.workspaceId === null
          ? undefined
          : eq(runningJobExecutions.workspaceId, params.workspaceId),
        isNotNull(runningJobExecutions.providerRunnerId),
      ),
    }),
  );
}

/**
 * Removes managed stop handoffs after the bounded grace without requiring a provisioner report.
 * This closes the cleanup path when a provisioner is revoked, disconnected, or has already
 * reported its provider runners as terminal.
 */
export async function removeExpiredManagedJobStopHandoffs(params: {
  graceSeconds: number;
  limit?: number;
}): Promise<JobStopHandoffCleanupResult> {
  return await db().transaction((tx) =>
    removeExpiredJobStopHandoffsTx(tx, {
      graceSeconds: params.graceSeconds,
      limit: params.limit,
      where: and(
        isNotNull(runningJobExecutions.provisionerId),
        isNotNull(runningJobExecutions.providerRunnerId),
      ),
    }),
  );
}

async function removeExpiredJobStopHandoffsTx(
  tx: Tx,
  params: {graceSeconds: number; limit?: number | undefined; where: SQL<unknown> | undefined},
): Promise<JobStopHandoffCleanupResult> {
  const cutoff = sql`now() - (${params.graceSeconds} || ' seconds')::interval`;
  const candidates = await tx
    .select({
      id: runningJobExecutions.id,
      jobExecutionId: runningJobExecutions.jobExecutionId,
      workspaceId: runningJobExecutions.workspaceId,
      provisionerId: runningJobExecutions.provisionerId,
      providerRunnerId: runningJobExecutions.providerRunnerId,
    })
    .from(runningJobExecutions)
    .where(
      and(
        params.where,
        isNotNull(runningJobExecutions.cancellationRequestedAt),
        lte(runningJobExecutions.cancellationRequestedAt, cutoff),
      ),
    )
    .orderBy(
      asc(runningJobExecutions.cancellationRequestedAt),
      asc(runningJobExecutions.jobExecutionId),
    )
    .limit(params.limit ?? defaultJobStopHandoffCleanupLimit);

  if (candidates.length === 0)
    return {removed: 0, reservationsReleased: 0, removedJobExecutionIds: []};

  const scopeKeys = [
    ...new Set(
      candidates.flatMap((candidate) =>
        candidate.provisionerId
          ? [candidate.workspaceId, candidate.provisionerId]
          : [candidate.workspaceId],
      ),
    ),
  ].sort();
  for (const scopeKey of scopeKeys)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${scopeKey}))`);

  for (const candidate of [...candidates].sort((a, b) =>
    a.jobExecutionId.localeCompare(b.jobExecutionId),
  )) {
    await lockJobExecution(tx, candidate.jobExecutionId);
  }

  const deleted = await tx
    .delete(runningJobExecutions)
    .where(
      and(
        inArray(
          runningJobExecutions.id,
          candidates.map((candidate) => candidate.id),
        ),
        params.where,
        isNotNull(runningJobExecutions.cancellationRequestedAt),
        lte(runningJobExecutions.cancellationRequestedAt, cutoff),
      ),
    )
    .returning({
      jobExecutionId: runningJobExecutions.jobExecutionId,
      provisionerId: runningJobExecutions.provisionerId,
      providerRunnerId: runningJobExecutions.providerRunnerId,
    });

  if (deleted.length === 0)
    return {removed: 0, reservationsReleased: 0, removedJobExecutionIds: []};
  const reservationsReleased = await releaseReservationsForTerminalRunningRows(tx, deleted);

  return {
    removed: deleted.length,
    reservationsReleased,
    removedJobExecutionIds: deleted.map((row) => row.jobExecutionId),
  };
}

/**
 * Removes expired stop handoffs for manual runners that cannot be associated with a provider
 * runner. The workspace and execution locks preserve the same ordering as terminal reconciliation
 * while allowing the maintenance tick to clean up a disconnected manual session.
 */
export async function removeExpiredUnlinkedJobStopHandoffs(params: {
  graceSeconds: number;
  limit?: number;
}): Promise<number> {
  return await db().transaction(async (tx) => {
    const cutoff = sql`now() - (${params.graceSeconds} || ' seconds')::interval`;
    const candidates = await tx
      .select({
        id: runningJobExecutions.id,
        jobExecutionId: runningJobExecutions.jobExecutionId,
        workspaceId: runningJobExecutions.workspaceId,
      })
      .from(runningJobExecutions)
      .where(
        and(
          isNull(runningJobExecutions.provisionerId),
          isNull(runningJobExecutions.providerRunnerId),
          isNotNull(runningJobExecutions.cancellationRequestedAt),
          lte(runningJobExecutions.cancellationRequestedAt, cutoff),
        ),
      )
      .orderBy(
        asc(runningJobExecutions.cancellationRequestedAt),
        asc(runningJobExecutions.jobExecutionId),
      )
      .limit(params.limit ?? defaultJobStopHandoffCleanupLimit);

    if (candidates.length === 0) return 0;

    const workspaceIds = [...new Set(candidates.map((candidate) => candidate.workspaceId))].sort();
    for (const workspaceId of workspaceIds) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
    }
    for (const candidate of [...candidates].sort((a, b) =>
      a.jobExecutionId.localeCompare(b.jobExecutionId),
    )) {
      await lockJobExecution(tx, candidate.jobExecutionId);
    }

    const deleted = await tx
      .delete(runningJobExecutions)
      .where(
        and(
          inArray(
            runningJobExecutions.id,
            candidates.map((candidate) => candidate.id),
          ),
          isNull(runningJobExecutions.provisionerId),
          isNull(runningJobExecutions.providerRunnerId),
          isNotNull(runningJobExecutions.cancellationRequestedAt),
          lte(runningJobExecutions.cancellationRequestedAt, cutoff),
        ),
      )
      .returning({id: runningJobExecutions.id});

    return deleted.length;
  });
}

export interface EnqueueJobExecutionParams {
  workspaceId: string;
  workflowRunId: string;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  projectId: string;
  requiredLabels: string[];
  queuedAt: Date;
}

export async function getWorkspaceJobCounts(params: {
  workspaceIds: string[];
}): Promise<Array<{workspaceId: string; queued: number; running: number}>> {
  const [pendingRows, runningRows] = await Promise.all([
    db()
      .select({workspaceId: pendingJobExecutions.workspaceId, count: count()})
      .from(pendingJobExecutions)
      .where(inArray(pendingJobExecutions.workspaceId, params.workspaceIds))
      .groupBy(pendingJobExecutions.workspaceId),
    db()
      .select({workspaceId: runningJobExecutions.workspaceId, count: count()})
      .from(runningJobExecutions)
      .where(inArray(runningJobExecutions.workspaceId, params.workspaceIds))
      .groupBy(runningJobExecutions.workspaceId),
  ]);

  const queuedByWorkspace = new Map(pendingRows.map((row) => [row.workspaceId, Number(row.count)]));
  const runningByWorkspace = new Map(
    runningRows.map((row) => [row.workspaceId, Number(row.count)]),
  );

  return params.workspaceIds.map((workspaceId) => ({
    workspaceId,
    queued: queuedByWorkspace.get(workspaceId) ?? 0,
    running: runningByWorkspace.get(workspaceId) ?? 0,
  }));
}

// The workflows outbox delivers queue facts at least once. The per-execution advisory lock and
// pending/running checks make replay a no-op across the claim transition. A durable lease-expired
// event also prevents a delayed replay from resurrecting an execution already reaped locally.
export async function enqueueJobExecution(params: EnqueueJobExecutionParams): Promise<void> {
  const requiredLabels = [...canonicalizeLabels(params.requiredLabels)];
  if (requiredLabels.length === 0) throw new EmptyRequiredLabelsError();

  const enqueued = await db().transaction(async (tx) => {
    await lockJobExecution(tx, params.jobExecutionId);

    const [running] = await tx
      .select({jobExecutionId: runningJobExecutions.jobExecutionId})
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobExecutionId, params.jobExecutionId))
      .limit(1);
    if (running) return false;

    const [leaseExpired] = await tx
      .select({id: runnersOutbox.id})
      .from(runnersOutbox)
      .where(
        and(
          eq(runnersOutbox.eventType, RUNNER_JOB_LEASE_EXPIRED),
          sql`${runnersOutbox.payload}->>'jobExecutionId' = ${params.jobExecutionId}`,
        ),
      )
      .limit(1);
    if (leaseExpired) return false;

    const [inserted] = await tx
      .insert(pendingJobExecutions)
      .values({
        workspaceId: params.workspaceId,
        workflowRunId: params.workflowRunId,
        workflowRunAttemptId: params.workflowRunAttemptId,
        jobId: params.jobId,
        jobExecutionId: params.jobExecutionId,
        projectId: params.projectId,
        requiredLabels,
        createdAt: params.queuedAt,
      })
      .onConflictDoNothing({target: pendingJobExecutions.jobExecutionId})
      .returning({createdAt: pendingJobExecutions.createdAt});

    return inserted !== undefined;
  });

  if (enqueued) jobExecutionEnqueuedCount.add(1);
}

export interface ClaimedJobExecution {
  workflowRunId: string;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  projectId: string;
}

export interface ActiveRunningJobExecution {
  workflowRunId: string;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  projectId: string;
  runnerSessionId: string;
  provisionerId: string | null;
  providerRunnerId: string | null;
  requiredLabels: string[];
  runnerLabels: string[];
  startedAt: Date;
  lastHeartbeatAt: Date;
}

export interface RunnerInstanceBoundJobExecution {
  workflowRunId: string;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  providerRunnerId: string;
  startedAt: Date;
  lastHeartbeatAt: Date;
  cancellationRequestedAt: Date | null;
  cancellationReason: RunnerJobStopReasonDto | null;
}

interface ClaimPendingJobExecutionParams {
  workspaceId: string;
  runnerSessionId: string;
  sessionLabels: string[];
  maxClaims: number | null;
  runnerSessionLivenessThrottleSeconds: number;
}

interface ClaimRunnerContext {
  provisionerId: string | null;
  providerRunnerId: string | null;
  renewableInference: boolean | null;
  runnerInstanceCondition: ReturnType<typeof eq> | undefined;
}

export async function claimPendingJobExecution(
  params: ClaimPendingJobExecutionParams,
): Promise<ClaimedJobExecution | null> {
  await touchRunnerSessionLiveness({
    workspaceId: params.workspaceId,
    runnerSessionId: params.runnerSessionId,
    throttleSeconds: params.runnerSessionLivenessThrottleSeconds,
  });

  if (params.sessionLabels.length === 0) return null;

  let activationToFirstClaimObservation: ProviderRunnerLifecycleObservation | null = null;
  let queueTimeObservation: JobExecutionQueueTimeObservation | null = null;
  let firstClaimReservationReleaseCount = 0;
  const result = await db().transaction(async (tx) => {
    const {provisionerId, providerRunnerId, renewableInference, runnerInstanceCondition} =
      await loadClaimRunnerContextTx(tx, params);

    // `id` is a uuidv7 (time-ordered), so it is a deterministic FIFO tiebreaker
    // for rows sharing a created_at within a batch. Lock only the FIFO candidate before
    // attempting its execution advisory lock; putting pg_try_advisory_xact_lock in this
    // predicate would evaluate it while scanning and temporarily lock many queue entries.
    const pendingClaim = await claimPendingCandidateTx(
      tx,
      params,
      provisionerId,
      providerRunnerId,
      renewableInference,
    );
    if (!pendingClaim) return null;
    const {row, claimed} = pendingClaim;

    queueTimeObservation = {
      durationMilliseconds: claimed.claimedAt.getTime() - row.createdAt.getTime(),
      provider: null,
      launchKind: params.maxClaims === null ? 'manual' : 'unknown',
    };

    if (runnerInstanceCondition) {
      const runnerClaim = await recordClaimedRunnerTx(
        tx,
        params.runnerSessionId,
        runnerInstanceCondition,
        claimed.claimedAt,
      );
      if (runnerClaim.claimedRunner && queueTimeObservation) {
        queueTimeObservation.provider = runnerClaim.claimedRunner.providerKind;
        queueTimeObservation.launchKind = runnerClaim.claimedRunner.launchKind;
      }
      firstClaimReservationReleaseCount += runnerClaim.reservationReleaseCount;
      activationToFirstClaimObservation = runnerClaim.activationToFirstClaimObservation;
    }

    if (params.maxClaims !== null) {
      await tx
        .update(runnerSessions)
        .set({claimsUsed: sql`${runnerSessions.claimsUsed} + 1`, updatedAt: sql`now()`})
        .where(eq(runnerSessions.id, params.runnerSessionId));
    }

    // The running-row insert is the runner claiming the job execution. Emit in the same tx; the
    // payload carries the row's own claim instant so a consumer records the true time,
    // not the outbox drain time.
    await writeOutboxEvent<RunnersEventMap>(tx, runnersOutbox, {
      type: RUNNER_JOB_CLAIMED,
      payload: {
        workflowRunId: row.workflowRunId,
        workflowRunAttemptId: row.workflowRunAttemptId,
        jobId: row.jobId,
        jobExecutionId: row.jobExecutionId,
        claimedAt: claimed.claimedAt.toISOString(),
      },
    });

    return {
      workflowRunId: row.workflowRunId,
      workflowRunAttemptId: row.workflowRunAttemptId,
      jobId: row.jobId,
      jobExecutionId: row.jobExecutionId,
      projectId: row.projectId,
    };
  });
  recordRunnerReservationReleased({
    count: firstClaimReservationReleaseCount,
    surface: 'first-claim',
  });
  if (queueTimeObservation) recordJobExecutionQueueTime(queueTimeObservation);
  if (activationToFirstClaimObservation)
    recordProviderRunnerActivationToFirstClaim(activationToFirstClaimObservation);
  return result;
}

async function loadClaimRunnerContextTx(
  tx: Tx,
  params: ClaimPendingJobExecutionParams,
): Promise<ClaimRunnerContext> {
  let runnerInstanceId: string | null = null;
  let provisionerId: string | null = null;
  let providerRunnerId: string | null = null;
  const sessionQuery = tx
    .select({
      maxClaims: runnerSessions.maxClaims,
      claimsUsed: runnerSessions.claimsUsed,
      revokedAt: runnerSessions.revokedAt,
      runnerInstanceId: runnerSessions.runnerInstanceId,
      provisionerId: runnerSessions.provisionerId,
      providerRunnerId: runnerSessions.providerRunnerId,
      toolCapabilities: runnerSessions.toolCapabilities,
    })
    .from(runnerSessions)
    .where(eq(runnerSessions.id, params.runnerSessionId))
    .limit(1);
  const [session] =
    params.maxClaims === null ? await sessionQuery : await sessionQuery.for('update');
  let renewableInference: boolean | null = null;
  if (params.maxClaims !== null) {
    assertClaimSessionAvailable(session, params.runnerSessionId);
    runnerInstanceId = session.runnerInstanceId;
    provisionerId = session.provisionerId;
    providerRunnerId = session.providerRunnerId;
  }
  // The execution owns this claim-time value. Do not derive it from report freshness.
  if (session)
    renewableInference = session.toolCapabilities?.features?.renewable_inference === true;
  const runnerInstanceCondition = claimRunnerInstanceCondition(
    runnerInstanceId,
    provisionerId,
    providerRunnerId,
  );
  if (runnerInstanceCondition && provisionerId) {
    await lockClaimRunnerReservationIdsTx(tx, provisionerId, runnerInstanceCondition);
  }
  return {provisionerId, providerRunnerId, renewableInference, runnerInstanceCondition};
}

function assertClaimSessionAvailable<
  T extends {revokedAt: Date | null; maxClaims: number | null; claimsUsed: number},
>(session: T | undefined, runnerSessionId: string): asserts session is T {
  if (
    !session ||
    session.revokedAt ||
    session.maxClaims === null ||
    session.claimsUsed >= session.maxClaims
  ) {
    throw new RunnerSessionExhaustedError(runnerSessionId);
  }
}

function claimRunnerInstanceCondition(
  runnerInstanceId: string | null,
  provisionerId: string | null,
  providerRunnerId: string | null,
): ReturnType<typeof eq> | undefined {
  if (runnerInstanceId) return eq(providerRunners.id, runnerInstanceId);
  if (provisionerId && providerRunnerId) {
    return and(
      eq(providerRunners.provisionerId, provisionerId),
      eq(providerRunners.providerRunnerId, providerRunnerId),
    );
  }
  return undefined;
}

async function lockClaimRunnerReservationIdsTx(
  tx: Tx,
  provisionerId: string,
  runnerInstanceCondition: ReturnType<typeof eq>,
): Promise<void> {
  const [runner] = await tx
    .select({
      reservationId: providerRunners.reservationId,
      intendedReservationId: providerRunners.intendedReservationId,
    })
    .from(providerRunners)
    .where(runnerInstanceCondition)
    .limit(1);
  await lockRunnerReservationAdvisoryKeysTx(tx, {
    provisionerId,
    reservationIds: [runner?.reservationId, runner?.intendedReservationId].filter(
      (reservationId): reservationId is string =>
        reservationId !== null && reservationId !== undefined,
    ),
  });
}

async function claimPendingCandidateTx(
  tx: Tx,
  params: ClaimPendingJobExecutionParams,
  provisionerId: string | null,
  providerRunnerId: string | null,
  renewableInference: boolean | null,
): Promise<{
  row: typeof pendingJobExecutions.$inferSelect;
  claimed: {claimedAt: Date};
} | null> {
  const candidate = tx
    .select()
    .from(pendingJobExecutions)
    .where(
      and(
        eq(pendingJobExecutions.workspaceId, params.workspaceId),
        arrayContained(pendingJobExecutions.requiredLabels, params.sessionLabels),
      ),
    )
    .orderBy(asc(pendingJobExecutions.createdAt), asc(pendingJobExecutions.id))
    .limit(1)
    .for('update', {skipLocked: true})
    .as('pending_candidate');
  const [row] = await tx
    .select()
    .from(candidate)
    .where(
      sql`pg_try_advisory_xact_lock(
        hashtext(${runnerJobExecutionLockPrefix} || ${candidate.jobExecutionId}::text)
      )`,
    );
  if (!row) return null;
  await tx.delete(pendingJobExecutions).where(eq(pendingJobExecutions.id, row.id));
  const [claimed] = await tx
    .insert(runningJobExecutions)
    .values({
      workspaceId: row.workspaceId,
      workflowRunId: row.workflowRunId,
      workflowRunAttemptId: row.workflowRunAttemptId,
      jobId: row.jobId,
      jobExecutionId: row.jobExecutionId,
      projectId: row.projectId,
      runnerSessionId: params.runnerSessionId,
      renewableInference,
      provisionerId,
      providerRunnerId,
      requiredLabels: row.requiredLabels,
      runnerLabels: params.sessionLabels,
    })
    .onConflictDoNothing({target: runningJobExecutions.jobExecutionId})
    .returning({claimedAt: runningJobExecutions.startedAt});
  return claimed ? {row, claimed} : null;
}

type ClaimedProviderRunner = Pick<
  typeof providerRunners.$inferSelect,
  | 'firstClaimedAt'
  | 'providerKind'
  | 'launchKind'
  | 'id'
  | 'reservationId'
  | 'intendedReservationId'
> & {isFirstClaim: boolean; sessionCreatedAtEpochMs: number | null};

async function recordClaimedRunnerTx(
  tx: Tx,
  runnerSessionId: string,
  runnerInstanceCondition: ReturnType<typeof eq>,
  claimedAt: Date,
): Promise<{
  claimedRunner: ClaimedProviderRunner | undefined;
  reservationReleaseCount: number;
  activationToFirstClaimObservation: ProviderRunnerLifecycleObservation | null;
}> {
  const [row] = await tx
    .update(providerRunners)
    .set({
      firstClaimedAt: sql`coalesce(${providerRunners.firstClaimedAt}, ${claimedAt})`,
      terminationAuthorizedAt: null,
      terminationReason: null,
      updatedAt: sql`now()`,
    })
    .where(runnerInstanceCondition)
    .returning({
      firstClaimedAt: providerRunners.firstClaimedAt,
      isFirstClaim: sql<boolean>`${providerRunners.firstClaimedAt} = ${claimedAt}`,
      providerKind: providerRunners.providerKind,
      launchKind: providerRunners.launchKind,
      id: providerRunners.id,
      reservationId: providerRunners.reservationId,
      intendedReservationId: providerRunners.intendedReservationId,
      sessionCreatedAtEpochMs: sql<number | null>`(
        select extract(epoch from ${runnerSessions.createdAt})::double precision * 1000
        from ${runnerSessions}
        where ${runnerSessions.id} = ${runnerSessionId}
      )`,
    });
  const reservationReleaseCount = row?.isFirstClaim
    ? await releaseFirstClaimReservationTx(tx, row)
    : 0;
  return {
    claimedRunner: row,
    reservationReleaseCount,
    activationToFirstClaimObservation: activationToFirstClaimObservationFor(row),
  };
}

async function releaseFirstClaimReservationTx(
  tx: Tx,
  runner: ClaimedProviderRunner,
): Promise<number> {
  const [releasedRunner] = await tx
    .update(providerRunners)
    .set({intendedReservationId: null, reservationReleasedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        eq(providerRunners.id, runner.id),
        or(
          isNotNull(providerRunners.reservationId),
          isNotNull(providerRunners.intendedReservationId),
        ),
        isNull(providerRunners.reservationReleasedAt),
      ),
    )
    .returning({provisionerId: providerRunners.provisionerId});
  const reservationId = runner.intendedReservationId ?? runner.reservationId;
  if (!releasedRunner?.provisionerId || !reservationId) return 0;
  const [reservation] = await tx
    .select({workspaceId: reservations.workspaceId})
    .from(reservations)
    .where(
      and(
        eq(reservations.id, reservationId),
        eq(reservations.provisionerId, releasedRunner.provisionerId),
      ),
    )
    .limit(1);
  if (!reservation) return 0;
  return releaseReservationUnits(tx, {
    workspaceId: reservation.workspaceId,
    provisionerId: releasedRunner.provisionerId,
    releases: [{reservationId, count: 1}],
  });
}

function activationToFirstClaimObservationFor(
  runner: ClaimedProviderRunner | undefined,
): ProviderRunnerLifecycleObservation | null {
  if (!runner?.isFirstClaim || runner.firstClaimedAt === null) return null;
  if (runner.sessionCreatedAtEpochMs === null) return null;
  return {
    durationMilliseconds: runner.firstClaimedAt.getTime() - runner.sessionCreatedAtEpochMs,
    provider: runner.providerKind,
    launchKind: runner.launchKind,
    runnerInstanceId: runner.id,
  };
}

async function touchRunnerSessionLiveness(params: {
  workspaceId: string;
  runnerSessionId: string;
  throttleSeconds: number;
}): Promise<void> {
  await db()
    .update(runnerSessions)
    .set({updatedAt: sql`now()`})
    .where(
      and(
        eq(runnerSessions.id, params.runnerSessionId),
        eq(runnerSessions.workspaceId, params.workspaceId),
        sql`${runnerSessions.updatedAt} < now() - (${params.throttleSeconds} || ' seconds')::interval`,
      ),
    );
}

/**
 * Reaps stale leases (bounded by `limit`), emitting one
 * `runners.job.lease_expired` event per reaped job execution.
 *
 * The cutoff is re-checked in the DELETE, not just the locking subquery, so a
 * heartbeat landing mid-call spares the live row. Each reaped execution also sweeps its
 * pending row so an at-least-once queue replay cannot leave an orphan.
 *
 * Locks pending-then-running to match `claimPendingJobExecution` and
 * `reconcileTerminalJobExecution`. The stale candidate scan intentionally does not lock
 * running rows first; the running-row DELETE re-checks the stale predicate after the
 * pending-row sweep.
 */
export async function expireStuckJobExecutions(params: {
  thresholdSeconds: number;
  noFirstHeartbeatGraceSeconds: number;
  correlatedStaleMinCount?: number;
  correlatedStaleRatio?: number;
  correlatedStaleMode?: 'defer' | 'shadow';
  correlatedStaleOverride?: boolean;
  limit?: number;
}): Promise<
  Array<{
    workflowRunId: string;
    workflowRunAttemptId: string;
    jobId: string;
    jobExecutionId: string;
  }>
> {
  const heartbeatCutoff = sql`now() - (${params.thresholdSeconds} || ' seconds')::interval`;
  const firstHeartbeatCutoff = sql`now() - (${params.noFirstHeartbeatGraceSeconds} || ' seconds')::interval`;
  const stalePredicate = or(
    and(
      isNull(runningJobExecutions.firstHeartbeatAt),
      lte(runningJobExecutions.lastHeartbeatAt, runningJobExecutions.startedAt),
      lt(runningJobExecutions.startedAt, firstHeartbeatCutoff),
    ),
    and(
      or(
        isNotNull(runningJobExecutions.firstHeartbeatAt),
        gt(runningJobExecutions.lastHeartbeatAt, runningJobExecutions.startedAt),
      ),
      lt(runningJobExecutions.lastHeartbeatAt, heartbeatCutoff),
    ),
  );
  const protectedStalePredicate = and(stalePredicate, protectedJobLeasePredicate());
  const protectedLeasePredicate = protectedJobLeasePredicate();

  // Keep the fleet-wide observation consistent without weakening the fresh liveness
  // re-check in the destructive transaction below.
  const {correlated, staleRatio} = await db().transaction(async (tx) => {
    await tx.execute(sql`set transaction isolation level repeatable read read only`);
    const [counts] = await tx
      .select({
        staleCount: sql<number>`count(*) filter (where ${protectedStalePredicate})`,
        liveLeaseCount: sql<number>`count(*) filter (where ${protectedLeasePredicate})`,
      })
      .from(runningJobExecutions);
    const staleCount = Number(counts?.staleCount ?? 0);
    const liveLeaseCount = Number(counts?.liveLeaseCount ?? 0);
    const staleRatio = liveLeaseCount > 0 ? staleCount / liveLeaseCount : 0;
    return {
      staleRatio,
      correlated:
        staleCount >= (params.correlatedStaleMinCount ?? 3) &&
        staleRatio >= (params.correlatedStaleRatio ?? 0.5),
    };
  });

  recordStaleJobCandidateRatio(staleRatio);

  const shouldDefer =
    correlated && !params.correlatedStaleOverride && params.correlatedStaleMode !== 'shadow';
  if (correlated && !params.correlatedStaleOverride) {
    if (params.correlatedStaleMode === 'shadow') {
      recordShadowedJobLeaseExpiry();
    } else {
      recordDeferredJobLeaseExpiry();
    }
  }
  if (shouldDefer) return [];

  const reaped = await db().transaction(async (tx) => {
    const staleRows = await tx
      .select({
        id: runningJobExecutions.id,
        jobExecutionId: runningJobExecutions.jobExecutionId,
      })
      .from(runningJobExecutions)
      .where(
        and(
          protectedStalePredicate,
          sql`
            pg_try_advisory_xact_lock(
              hashtext(${runnerJobExecutionLockPrefix} || ${runningJobExecutions.jobExecutionId}::text)
            )
          `,
        ),
      )
      .orderBy(
        asc(
          sql`CASE WHEN ${runningJobExecutions.firstHeartbeatAt} IS NULL AND ${runningJobExecutions.lastHeartbeatAt} <= ${runningJobExecutions.startedAt} THEN ${runningJobExecutions.startedAt} ELSE ${runningJobExecutions.lastHeartbeatAt} END`,
        ),
        asc(runningJobExecutions.id),
      )
      .limit(params.limit ?? 100);

    if (staleRows.length === 0) return [];

    const staleIds = staleRows.map((row) => row.id);
    const staleJobExecutionIds = staleRows.map((row) => row.jobExecutionId);

    // Sweep pending rows first so this transaction cannot hold a running-row lock while waiting
    // for a pending-row lock held by reconciliation or a claim of an orphan pending row. The
    // advisory lock acquired in the candidate scan also makes enqueue retries wait until this
    // transaction has either reaped the execution or released its lock without selecting it.
    await tx
      .delete(pendingJobExecutions)
      .where(inArray(pendingJobExecutions.jobExecutionId, staleJobExecutionIds));

    const deleted = await tx
      .delete(runningJobExecutions)
      .where(and(inArray(runningJobExecutions.id, staleIds), protectedStalePredicate))
      .returning({
        workflowRunId: runningJobExecutions.workflowRunId,
        workflowRunAttemptId: runningJobExecutions.workflowRunAttemptId,
        jobId: runningJobExecutions.jobId,
        jobExecutionId: runningJobExecutions.jobExecutionId,
        provisionerId: runningJobExecutions.provisionerId,
        providerRunnerId: runningJobExecutions.providerRunnerId,
      });

    if (deleted.length === 0) return [];

    await releaseReservationsForTerminalRunningRows(tx, deleted);

    await writeOutboxEvents<RunnersEventMap>(
      tx,
      runnersOutbox,
      deleted.map((row) => ({
        type: RUNNER_JOB_LEASE_EXPIRED,
        payload: {
          workflowRunId: row.workflowRunId,
          workflowRunAttemptId: row.workflowRunAttemptId,
          jobId: row.jobId,
          jobExecutionId: row.jobExecutionId,
        },
      })),
    );

    return deleted.map(({workflowRunId, workflowRunAttemptId, jobId, jobExecutionId}) => ({
      workflowRunId,
      workflowRunAttemptId,
      jobId,
      jobExecutionId,
    }));
  });

  if (reaped.length > 0) jobExecutionLeaseExpiredCount.add(reaped.length);

  return reaped;
}

export async function getJobExecutionQueueDepth(): Promise<{
  pendingJobExecutions: number;
  runningJobExecutions: number;
}> {
  const [pending] = await db().select({value: count()}).from(pendingJobExecutions);
  const [running] = await db().select({value: count()}).from(runningJobExecutions);
  return {
    pendingJobExecutions: pending?.value ?? 0,
    runningJobExecutions: running?.value ?? 0,
  };
}

export async function listActiveRunningJobExecutions(params: {
  workspaceId: string;
  windowSeconds: number;
  limit?: number;
}): Promise<ActiveRunningJobExecution[]> {
  return await db()
    .select({
      jobId: runningJobExecutions.jobId,
      jobExecutionId: runningJobExecutions.jobExecutionId,
      workflowRunId: runningJobExecutions.workflowRunId,
      workflowRunAttemptId: runningJobExecutions.workflowRunAttemptId,
      projectId: runningJobExecutions.projectId,
      runnerSessionId: runningJobExecutions.runnerSessionId,
      provisionerId: runningJobExecutions.provisionerId,
      providerRunnerId: runningJobExecutions.providerRunnerId,
      requiredLabels: runningJobExecutions.requiredLabels,
      runnerLabels: runningJobExecutions.runnerLabels,
      startedAt: runningJobExecutions.startedAt,
      lastHeartbeatAt: runningJobExecutions.lastHeartbeatAt,
    })
    .from(runningJobExecutions)
    .where(
      and(
        eq(runningJobExecutions.workspaceId, params.workspaceId),
        sql`${runningJobExecutions.lastHeartbeatAt} > now() - (${params.windowSeconds} || ' seconds')::interval`,
      ),
    )
    .orderBy(desc(runningJobExecutions.lastHeartbeatAt), desc(runningJobExecutions.id))
    .limit(params.limit ?? 1000);
}

export async function listRunningJobExecutionsByRunnerInstanceTx(
  tx: Tx,
  params: {
    workspaceId: string;
    provisionerId: string;
    providerRunnerIds: string[];
  },
): Promise<RunnerInstanceBoundJobExecution[]> {
  if (params.providerRunnerIds.length === 0) return [];

  const duplicateRows = await tx
    .select({
      providerRunnerId: runningJobExecutions.providerRunnerId,
      count: count(),
    })
    .from(runningJobExecutions)
    .where(
      and(
        eq(runningJobExecutions.workspaceId, params.workspaceId),
        eq(runningJobExecutions.provisionerId, params.provisionerId),
        inArray(runningJobExecutions.providerRunnerId, params.providerRunnerIds),
      ),
    )
    .groupBy(runningJobExecutions.providerRunnerId)
    .having(sql`count(*) > 1`);

  const duplicateRunnerInstanceIds = duplicateRows.flatMap((row) =>
    row.providerRunnerId ? [row.providerRunnerId] : [],
  );
  if (duplicateRunnerInstanceIds.length > 0) {
    logger().warn(
      {
        workspaceId: params.workspaceId,
        provisionerId: params.provisionerId,
        providerRunnerIds: duplicateRunnerInstanceIds,
      },
      'multiple running job executions are bound to the same provisioned runner',
    );
  }

  const result = await tx.execute<{
    workflowRunId: string;
    workflowRunAttemptId: string;
    jobId: string;
    jobExecutionId: string;
    providerRunnerId: string;
    startedAt: Date | string;
    lastHeartbeatAt: Date | string;
    cancellationRequestedAt: Date | string | null;
    cancellationReason: RunnerJobStopReasonDto | null;
  }>(sql`
    SELECT DISTINCT ON (${runningJobExecutions.providerRunnerId})
      ${runningJobExecutions.workflowRunId} AS "workflowRunId",
      ${runningJobExecutions.workflowRunAttemptId} AS "workflowRunAttemptId",
      ${runningJobExecutions.jobId} AS "jobId",
      ${runningJobExecutions.jobExecutionId} AS "jobExecutionId",
      ${runningJobExecutions.providerRunnerId} AS "providerRunnerId",
      ${runningJobExecutions.startedAt} AS "startedAt",
      ${runningJobExecutions.lastHeartbeatAt} AS "lastHeartbeatAt",
      ${runningJobExecutions.cancellationRequestedAt} AS "cancellationRequestedAt",
      ${runningJobExecutions.cancellationReason} AS "cancellationReason"
    FROM ${runningJobExecutions}
    WHERE
      ${runningJobExecutions.workspaceId} = ${params.workspaceId}
      AND ${runningJobExecutions.provisionerId} = ${params.provisionerId}
      AND ${runningJobExecutions.providerRunnerId} IN (${sql.join(
        params.providerRunnerIds.map((providerRunnerId) => sql`${providerRunnerId}`),
        sql`, `,
      )})
    ORDER BY ${runningJobExecutions.providerRunnerId}, ${runningJobExecutions.startedAt} DESC, ${runningJobExecutions.jobExecutionId} DESC
  `);

  return result.rows.map((row) => ({
    workflowRunId: row.workflowRunId,
    workflowRunAttemptId: row.workflowRunAttemptId,
    jobId: row.jobId,
    jobExecutionId: row.jobExecutionId,
    providerRunnerId: row.providerRunnerId,
    startedAt: toDate(row.startedAt),
    lastHeartbeatAt: toDate(row.lastHeartbeatAt),
    cancellationRequestedAt: row.cancellationRequestedAt
      ? toDate(row.cancellationRequestedAt)
      : null,
    cancellationReason: row.cancellationReason,
  }));
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export async function isJobLeaseActive(params: {
  jobId?: string;
  jobExecutionId: string;
  runnerSessionId: string;
}): Promise<boolean> {
  const state = await getJobLeaseState(params);
  return state.active;
}

export interface JobLeaseState {
  active: boolean;
  renewableInference?: boolean;
}

export async function getJobLeaseState(params: {
  jobId?: string;
  jobExecutionId: string;
  runnerSessionId: string;
}): Promise<JobLeaseState> {
  const [row] = await db()
    .select({
      id: runningJobExecutions.id,
      renewableInference: runningJobExecutions.renewableInference,
    })
    .from(runningJobExecutions)
    .where(
      and(
        eq(runningJobExecutions.jobExecutionId, params.jobExecutionId),
        eq(runningJobExecutions.runnerSessionId, params.runnerSessionId),
        params.jobId === undefined ? undefined : eq(runningJobExecutions.jobId, params.jobId),
      ),
    )
    .limit(1);

  if (!row) return {active: false};
  return {
    active: true,
    ...(row.renewableInference === null ? {} : {renewableInference: row.renewableInference}),
  };
}

export async function recordHeartbeat(params: {
  jobExecutionId: string;
  runnerSessionId: string;
  toolCapabilities?: RunnerToolCapabilitiesDto | null;
}): Promise<{
  cancellationRequested: boolean;
  cancellationReason: RunnerJobStopReasonDto | null;
  previousToolCapabilities: RunnerToolCapabilitiesDto | null;
  currentToolCapabilities: RunnerToolCapabilitiesDto | null;
  runningJobExecution: {
    workflowRunId: string;
    workflowRunAttemptId: string;
    jobId: string;
    jobExecutionId: string;
    projectId: string;
    workspaceId: string;
    runnerSessionId: string;
  };
}> {
  const result = await db().transaction(async (tx) => {
    const updated = await tx
      .update(runningJobExecutions)
      .set({
        firstHeartbeatAt: sql`COALESCE(${runningJobExecutions.firstHeartbeatAt}, now())`,
        lastHeartbeatAt: sql`now()`,
      })
      .where(
        and(
          eq(runningJobExecutions.jobExecutionId, params.jobExecutionId),
          eq(runningJobExecutions.runnerSessionId, params.runnerSessionId),
        ),
      )
      .returning({
        cancellationRequestedAt: runningJobExecutions.cancellationRequestedAt,
        cancellationReason: runningJobExecutions.cancellationReason,
        workflowRunId: runningJobExecutions.workflowRunId,
        workflowRunAttemptId: runningJobExecutions.workflowRunAttemptId,
        jobId: runningJobExecutions.jobId,
        jobExecutionId: runningJobExecutions.jobExecutionId,
        projectId: runningJobExecutions.projectId,
        workspaceId: runningJobExecutions.workspaceId,
        runnerSessionId: runningJobExecutions.runnerSessionId,
        provisionerId: runningJobExecutions.provisionerId,
        providerRunnerId: runningJobExecutions.providerRunnerId,
      });

    const row = updated[0];
    if (!row) throw new RunningJobExecutionNotFoundError(params.jobExecutionId);

    // A cancel:true response asks a managed runner to stop; it is not proof that local work has
    // stopped, so keep its handoff row until a terminal report or the bounded cleanup grace
    // authorizes provider termination. Manual runners have no provider to fence, so their
    // heartbeat is the acknowledgement that allows the handoff row to be removed.
    if (
      row.cancellationRequestedAt !== null &&
      row.provisionerId === null &&
      row.providerRunnerId === null
    ) {
      await tx
        .delete(runningJobExecutions)
        .where(
          and(
            eq(runningJobExecutions.jobExecutionId, params.jobExecutionId),
            eq(runningJobExecutions.runnerSessionId, params.runnerSessionId),
            isNotNull(runningJobExecutions.cancellationRequestedAt),
          ),
        );
    }

    const [previous] = await tx
      .select({toolCapabilities: runnerSessions.toolCapabilities})
      .from(runnerSessions)
      .where(eq(runnerSessions.id, params.runnerSessionId))
      .limit(1)
      .for('update');

    const [session] = await tx
      .update(runnerSessions)
      .set({
        toolCapabilities: params.toolCapabilities ?? null,
        toolCapabilitiesReportedAt: params.toolCapabilities ? sql`now()` : null,
        updatedAt: sql`now()`,
      })
      .where(eq(runnerSessions.id, params.runnerSessionId))
      .returning({toolCapabilities: runnerSessions.toolCapabilities});

    return {
      row,
      previousToolCapabilities: previous?.toolCapabilities ?? null,
      currentToolCapabilities: session?.toolCapabilities ?? null,
    };
  });

  const row = result.row;
  if (!row) throw new RunningJobExecutionNotFoundError(params.jobExecutionId);
  return {
    cancellationRequested: row.cancellationRequestedAt !== null,
    cancellationReason: row.cancellationReason,
    previousToolCapabilities: result.previousToolCapabilities,
    currentToolCapabilities: result.currentToolCapabilities,
    runningJobExecution: {
      workflowRunId: row.workflowRunId,
      workflowRunAttemptId: row.workflowRunAttemptId,
      jobId: row.jobId,
      jobExecutionId: row.jobExecutionId,
      projectId: row.projectId,
      workspaceId: row.workspaceId,
      runnerSessionId: row.runnerSessionId,
    },
  };
}

/**
 * Reconciles a terminal job execution with runner state in one transaction: removes its pending
 * queue row, deletes normal terminal leases, preserves cancellation/timeout stop handoffs, and
 * converges any linked reservation. The operation is idempotent and preserves the first
 * cancellation-request timestamp.
 */
type JobExecutionDatabase = ReturnType<typeof db> | Tx;

async function findJobExecutionWorkspaceId(
  query: JobExecutionDatabase,
  jobExecutionId: string,
): Promise<string | null> {
  const [pending] = await query
    .select({workspaceId: pendingJobExecutions.workspaceId})
    .from(pendingJobExecutions)
    .where(eq(pendingJobExecutions.jobExecutionId, jobExecutionId))
    .limit(1);
  if (pending) return pending.workspaceId;

  const [running] = await query
    .select({workspaceId: runningJobExecutions.workspaceId})
    .from(runningJobExecutions)
    .where(eq(runningJobExecutions.jobExecutionId, jobExecutionId))
    .limit(1);
  return running?.workspaceId ?? null;
}

export async function reconcileTerminalJobExecution(params: {
  jobExecutionId: string;
  cancellationReason?: RunnerJobStopReasonDto | null;
  finishedAt?: Date;
}): Promise<void> {
  const initialWorkspaceId = await findJobExecutionWorkspaceId(db(), params.jobExecutionId);
  const finishedAt = params.finishedAt ?? new Date();

  await db().transaction(async (tx) => {
    // Preserve workspace-first ordering when the initial lookup found a row. When it did not,
    // take the execution lock before rechecking so a concurrent queue fact cannot be missed.
    if (initialWorkspaceId) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${initialWorkspaceId}))`);
    }
    await lockJobExecution(tx, params.jobExecutionId);
    const workspaceId = await findJobExecutionWorkspaceId(tx, params.jobExecutionId);
    if (!workspaceId) return;
    if (!initialWorkspaceId) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
    }

    // Delete pending before updating running to match lock order with claim. Claim locks pending
    // rows before inserting the running lease, so this ordering makes terminal reconciliation
    // either win before claim or cancel the new lease.
    await tx
      .delete(pendingJobExecutions)
      .where(eq(pendingJobExecutions.jobExecutionId, params.jobExecutionId));
    const cancelledRunningRows = params.cancellationReason
      ? await tx
          .update(runningJobExecutions)
          .set({
            cancellationRequestedAt: sql`COALESCE(${runningJobExecutions.cancellationRequestedAt}, now())`,
            cancellationReason: sql`COALESCE(${runningJobExecutions.cancellationReason}, ${params.cancellationReason})`,
          })
          .where(eq(runningJobExecutions.jobExecutionId, params.jobExecutionId))
          .returning({
            provisionerId: runningJobExecutions.provisionerId,
            providerRunnerId: runningJobExecutions.providerRunnerId,
            runnerSessionId: runningJobExecutions.runnerSessionId,
          })
      : await tx
          .delete(runningJobExecutions)
          .where(
            and(
              eq(runningJobExecutions.jobExecutionId, params.jobExecutionId),
              isNull(runningJobExecutions.cancellationRequestedAt),
            ),
          )
          .returning({
            provisionerId: runningJobExecutions.provisionerId,
            providerRunnerId: runningJobExecutions.providerRunnerId,
            runnerSessionId: runningJobExecutions.runnerSessionId,
          });

    const runnerSessionIds = [...new Set(cancelledRunningRows.map((row) => row.runnerSessionId))];
    if (runnerSessionIds.length > 0) {
      await tx
        .update(runnerSessions)
        .set({
          lastJobCompletedAt: sql`greatest(coalesce(${runnerSessions.lastJobCompletedAt}, ${finishedAt}), ${finishedAt})`,
        })
        .where(inArray(runnerSessions.id, runnerSessionIds));
    }

    await releaseReservationsForTerminalRunningRows(tx, cancelledRunningRows);
  });
}
