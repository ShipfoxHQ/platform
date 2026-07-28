import {
  RUNNER_JOB_CLAIMED,
  RUNNER_JOB_LEASE_EXPIRED,
  RUNNER_JOB_QUEUED,
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
  sql,
} from 'drizzle-orm';
import {
  EmptyRequiredLabelsError,
  RunnerSessionExhaustedError,
  RunningJobExecutionNotFoundError,
} from '#core/errors.js';
import {jobExecutionEnqueuedCount, jobExecutionLeaseExpiredCount} from '#metrics/instance.js';
import type {Tx} from './db.js';
import {db} from './db.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobExecutions} from './schema/pending-job-executions.js';
import {providerRunners} from './schema/runner-instances.js';
import {runnerSessions} from './schema/runner-sessions.js';
import {runningJobExecutions} from './schema/running-job-executions.js';

export interface EnqueueJobExecutionParams {
  workspaceId: string;
  workflowRunId: string;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  projectId: string;
  requiredLabels: string[];
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

// Idempotent while the job execution is still pending: a duplicate jobExecutionId already in
// `runners_pending_jobs` is a no-op. Temporal retries the enqueue activity
// at-least-once, so a unique-violation throw on a retry-after-lost-result
// would permanently fail a healthy job execution's workflow. The guard does not extend
// past the claim: once the job execution has moved to `runners_running_jobs`, a retry
// can reinsert an orphan pending row, which a later `claimPendingJobExecution` drops
// via the running-execution unique constraint (onConflictDoNothing) instead of failing.
export async function enqueueJobExecution(params: EnqueueJobExecutionParams): Promise<void> {
  const requiredLabels = [...canonicalizeLabels(params.requiredLabels)];
  if (requiredLabels.length === 0) throw new EmptyRequiredLabelsError();

  const enqueued = await db().transaction(async (tx) => {
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
      })
      .onConflictDoNothing({target: pendingJobExecutions.jobExecutionId})
      .returning({createdAt: pendingJobExecutions.createdAt});

    // A retry that hits the conflict inserts nothing: the first enqueue already
    // emitted the queued event (durably, in the outbox), so re-emitting would
    // only add a redundant row the subscriber coalesces away. Skip it.
    if (!inserted) return false;

    await writeOutboxEvent<RunnersEventMap>(tx, runnersOutbox, {
      type: RUNNER_JOB_QUEUED,
      payload: {
        workflowRunId: params.workflowRunId,
        workflowRunAttemptId: params.workflowRunAttemptId,
        jobId: params.jobId,
        jobExecutionId: params.jobExecutionId,
        queuedAt: inserted.createdAt.toISOString(),
      },
    });
    return true;
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
}

export async function claimPendingJobExecution(params: {
  workspaceId: string;
  runnerSessionId: string;
  sessionLabels: string[];
  maxClaims: number | null;
  runnerSessionLivenessThrottleSeconds: number;
}): Promise<ClaimedJobExecution | null> {
  await touchRunnerSessionLiveness({
    workspaceId: params.workspaceId,
    runnerSessionId: params.runnerSessionId,
    throttleSeconds: params.runnerSessionLivenessThrottleSeconds,
  });

  if (params.sessionLabels.length === 0) return null;

  return await db().transaction(async (tx) => {
    let provisionerId: string | null = null;
    let providerRunnerId: string | null = null;
    let runnerInstanceId: string | null = null;

    if (params.maxClaims !== null) {
      const [session] = await tx
        .select({
          maxClaims: runnerSessions.maxClaims,
          claimsUsed: runnerSessions.claimsUsed,
          revokedAt: runnerSessions.revokedAt,
          runnerInstanceId: runnerSessions.runnerInstanceId,
          provisionerId: runnerSessions.provisionerId,
          providerRunnerId: runnerSessions.providerRunnerId,
        })
        .from(runnerSessions)
        .where(eq(runnerSessions.id, params.runnerSessionId))
        .limit(1)
        .for('update');

      if (
        !session ||
        session.revokedAt ||
        session.maxClaims === null ||
        session.claimsUsed >= session.maxClaims
      ) {
        throw new RunnerSessionExhaustedError(params.runnerSessionId);
      }

      // Ephemeral sessions are the only capped sessions, and the DB check keeps
      // their provisioned-runner link present as a pair.
      runnerInstanceId = session.runnerInstanceId;
      provisionerId = session.provisionerId;
      providerRunnerId = session.providerRunnerId;
    }

    // `id` is a uuidv7 (time-ordered), so it is a deterministic FIFO tiebreaker
    // for rows sharing a created_at within a batch.
    const [row] = await tx
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
      .for('update', {skipLocked: true});

    if (!row) return null;

    await tx.delete(pendingJobExecutions).where(eq(pendingJobExecutions.id, row.id));

    // An enqueue retry that lands after a prior claim can leave an orphan pending
    // row whose jobExecutionId is already in `runners_running_jobs`. Insert-or-skip
    // on the jobExecutionId unique constraint: when the job execution is already running
    // the insert touches no row, so we commit the orphan's deletion and return
    // null rather than let the unique violation roll the claim back into a poison
    // loop. The runner just re-polls for a real job execution.
    const inserted = await tx
      .insert(runningJobExecutions)
      .values({
        workspaceId: row.workspaceId,
        workflowRunId: row.workflowRunId,
        workflowRunAttemptId: row.workflowRunAttemptId,
        jobId: row.jobId,
        jobExecutionId: row.jobExecutionId,
        projectId: row.projectId,
        runnerSessionId: params.runnerSessionId,
        provisionerId,
        providerRunnerId,
        requiredLabels: row.requiredLabels,
        runnerLabels: params.sessionLabels,
      })
      .onConflictDoNothing({target: runningJobExecutions.jobExecutionId})
      .returning({claimedAt: runningJobExecutions.startedAt});

    const claimed = inserted[0];
    if (!claimed) return null;

    const runnerInstanceCondition = runnerInstanceId
      ? eq(providerRunners.id, runnerInstanceId)
      : provisionerId && providerRunnerId
        ? and(
            eq(providerRunners.provisionerId, provisionerId),
            eq(providerRunners.providerRunnerId, providerRunnerId),
          )
        : null;
    if (runnerInstanceCondition) {
      await tx
        .update(providerRunners)
        .set({
          firstClaimedAt: sql`coalesce(${providerRunners.firstClaimedAt}, ${claimed.claimedAt})`,
          updatedAt: sql`now()`,
        })
        .where(runnerInstanceCondition);
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
 * Releases a job execution's lease when the orchestration workflow finalizes it: deletes the
 * running-job-execution row AND any lingering pending row for the same execution, in one tx.
 * Idempotent (0-row no-op), no token scope (the workflow is authoritative), and
 * emits no event — the workflow already owns the outcome. Sweeping the pending row
 * too closes the at-least-once window where an enqueue retry left an orphan that a
 * later claim would otherwise pick up for an already-finished job execution.
 */
export async function releaseJobExecution(params: {jobExecutionId: string}): Promise<void> {
  await db().transaction(async (tx) => {
    // Delete pending before running to match `claimPendingJobExecution`'s lock-acquisition
    // order (it locks the pending row first, then the running row). A concurrent
    // claim picking up an orphan pending row for this same job execution would otherwise
    // deadlock against the reverse order here.
    await tx
      .delete(pendingJobExecutions)
      .where(eq(pendingJobExecutions.jobExecutionId, params.jobExecutionId));
    await tx
      .delete(runningJobExecutions)
      .where(eq(runningJobExecutions.jobExecutionId, params.jobExecutionId));
  });
}

/**
 * Reaps stale leases (bounded by `limit`), emitting one
 * `runners.job.lease_expired` event per reaped job execution.
 *
 * The cutoff is re-checked in the DELETE, not just the locking subquery, so a
 * heartbeat landing mid-call spares the live row. Each reaped execution also sweeps its
 * pending row: a failed best-effort `releaseJobExecution` would otherwise leave an orphan
 * that a later claim re-runs as an already-finished job execution.
 *
 * Locks running-then-pending, the inverse of `claimPendingJobExecution` / `releaseJobExecution`.
 * That pre-existing asymmetry opens a narrow deadlock window against a concurrent
 * claim of the same orphan-pending job execution; Postgres breaks it and the cron retries.
 */
export async function expireStuckJobExecutions(params: {
  thresholdSeconds: number;
  noFirstHeartbeatGraceSeconds: number;
  limit?: number;
}): Promise<
  Array<{
    workflowRunId: string;
    workflowRunAttemptId: string;
    jobId: string;
    jobExecutionId: string;
  }>
> {
  const reaped = await db().transaction(async (tx) => {
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

    const staleIds = tx
      .select({id: runningJobExecutions.id})
      .from(runningJobExecutions)
      .where(stalePredicate)
      .orderBy(
        asc(
          sql`CASE WHEN ${runningJobExecutions.firstHeartbeatAt} IS NULL AND ${runningJobExecutions.lastHeartbeatAt} <= ${runningJobExecutions.startedAt} THEN ${runningJobExecutions.startedAt} ELSE ${runningJobExecutions.lastHeartbeatAt} END`,
        ),
      )
      .limit(params.limit ?? 100)
      .for('update', {skipLocked: true});

    const deleted = await tx
      .delete(runningJobExecutions)
      .where(and(inArray(runningJobExecutions.id, staleIds), stalePredicate))
      .returning({
        workflowRunId: runningJobExecutions.workflowRunId,
        workflowRunAttemptId: runningJobExecutions.workflowRunAttemptId,
        jobId: runningJobExecutions.jobId,
        jobExecutionId: runningJobExecutions.jobExecutionId,
      });

    if (deleted.length === 0) return [];

    await tx.delete(pendingJobExecutions).where(
      inArray(
        pendingJobExecutions.jobExecutionId,
        deleted.map((row) => row.jobExecutionId),
      ),
    );

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

    return deleted;
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
  }>(sql`
    SELECT DISTINCT ON (${runningJobExecutions.providerRunnerId})
      ${runningJobExecutions.workflowRunId} AS "workflowRunId",
      ${runningJobExecutions.workflowRunAttemptId} AS "workflowRunAttemptId",
      ${runningJobExecutions.jobId} AS "jobId",
      ${runningJobExecutions.jobExecutionId} AS "jobExecutionId",
      ${runningJobExecutions.providerRunnerId} AS "providerRunnerId",
      ${runningJobExecutions.startedAt} AS "startedAt",
      ${runningJobExecutions.lastHeartbeatAt} AS "lastHeartbeatAt",
      ${runningJobExecutions.cancellationRequestedAt} AS "cancellationRequestedAt"
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
  const [row] = await db()
    .select({id: runningJobExecutions.id})
    .from(runningJobExecutions)
    .where(
      and(
        eq(runningJobExecutions.jobExecutionId, params.jobExecutionId),
        eq(runningJobExecutions.runnerSessionId, params.runnerSessionId),
        params.jobId === undefined ? undefined : eq(runningJobExecutions.jobId, params.jobId),
      ),
    )
    .limit(1);

  return row !== undefined;
}

export async function recordHeartbeat(params: {
  jobExecutionId: string;
  runnerSessionId: string;
  toolCapabilities?: RunnerToolCapabilitiesDto | null;
}): Promise<{
  cancellationRequested: boolean;
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
        workflowRunId: runningJobExecutions.workflowRunId,
        workflowRunAttemptId: runningJobExecutions.workflowRunAttemptId,
        jobId: runningJobExecutions.jobId,
        jobExecutionId: runningJobExecutions.jobExecutionId,
        projectId: runningJobExecutions.projectId,
        workspaceId: runningJobExecutions.workspaceId,
        runnerSessionId: runningJobExecutions.runnerSessionId,
      });

    const row = updated[0];
    if (!row) throw new RunningJobExecutionNotFoundError(params.jobExecutionId);

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

export async function requestJobExecutionCancellation(params: {
  jobExecutionId: string;
}): Promise<void> {
  await db()
    .update(runningJobExecutions)
    .set({
      cancellationRequestedAt: sql`COALESCE(${runningJobExecutions.cancellationRequestedAt}, now())`,
    })
    .where(eq(runningJobExecutions.jobExecutionId, params.jobExecutionId));
}

export async function cancelRunnerJobs(params: {jobIds: string[]}): Promise<void> {
  if (params.jobIds.length === 0) return;

  await db().transaction(async (tx) => {
    await tx.delete(pendingJobExecutions).where(inArray(pendingJobExecutions.jobId, params.jobIds));
    await tx
      .update(runningJobExecutions)
      .set({
        cancellationRequestedAt: sql`COALESCE(${runningJobExecutions.cancellationRequestedAt}, now())`,
      })
      .where(inArray(runningJobExecutions.jobId, params.jobIds));
  });
}
