import {
  WORKFLOWS_WORKFLOW_RUN_CANCELLED,
  WORKFLOWS_WORKFLOW_RUN_TERMINATED,
} from '@shipfox/api-workflows-dto';
import {and, asc, eq, inArray, notInArray, sql} from 'drizzle-orm';
import {isJobTerminal, type Job, type JobStatusReason} from '#core/entities/job.js';
import {
  isWorkflowRunTerminal,
  type WorkflowRun,
  type WorkflowRunStatus,
} from '#core/entities/workflow-run.js';
import {WorkflowRunNotCancellableError, WorkflowRunNotFoundError} from '#core/errors.js';
import {
  recordWorkflowJobStatusChanged,
  recordWorkflowListenerEventOutcome,
  recordWorkflowRunStatusChanged,
} from '#metrics/instance.js';
import {db, type Tx} from '../db.js';
import {
  type FinalizedListenerEventCounts,
  finalizePendingListenerEvents,
} from '../job-listener-events.js';
import {writeWorkflowsOutboxEvent} from '../outbox-writes.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobs} from '../schema/jobs.js';
import {steps} from '../schema/steps.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {toWorkflowRun, workflowRuns} from '../schema/workflow-runs.js';
import {updateJobStatusAtVersion} from './jobs.js';
import {writeJobExecutionTerminatedOutbox} from './outbox.js';
import {
  lockWorkflowRun,
  TERMINAL_EXECUTION_STATUSES,
  TERMINAL_WORKFLOW_RUN_STATUSES,
} from './shared.js';
import {bulkUpdateStepStatuses} from './steps.js';

export interface CancelWorkflowRunParams {
  workflowRunId: string;
}

export interface FailWorkflowRunAsTimedOutParams {
  runAttemptId: string;
}

export interface RunTerminationSpec {
  terminalStatus: Extract<WorkflowRunStatus, 'failed' | 'cancelled'>;
  statusReason: Extract<JobStatusReason, 'timed_out' | 'run_cancelled'>;
  markExecutionTimedOut: boolean;
  emitCancelledEvent: boolean;
}

function finalizeCancelledListenerEvents(
  tx: Tx,
  jobId: string,
  spec: RunTerminationSpec,
): Promise<FinalizedListenerEventCounts> {
  if (spec.statusReason !== 'run_cancelled') {
    return Promise.resolve({honored: 0, abandoned: 0});
  }
  return finalizePendingListenerEvents(tx, {jobId, reason: 'cancelled'});
}

/**
 * Shared terminal transition for a run attempt. The caller locks the run and the
 * attempt (and decides how an already-terminal run is handled: timeout returns
 * idempotently, cancellation rejects), then this drives every non-terminal job,
 * execution, and step to `spec.terminalStatus`, resolves still-listening jobs,
 * flips the attempt and run, and writes the outbox. Callers record metrics after
 * the transaction commits.
 */
async function terminateRunAttempt(
  tx: Tx,
  params: {
    lockedRun: typeof workflowRuns.$inferSelect;
    lockedAttempt: typeof workflowRunAttempts.$inferSelect;
    spec: RunTerminationSpec;
  },
): Promise<{
  run: WorkflowRun;
  changedJobs: Job[];
  listenerEventOutcomes: FinalizedListenerEventCounts;
}> {
  const {lockedRun, lockedAttempt, spec} = params;
  const listenerEventOutcomes: FinalizedListenerEventCounts = {honored: 0, abandoned: 0};

  const runJobExecutionIds = tx
    .select({id: jobExecutions.id})
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .where(eq(jobs.workflowRunAttemptId, lockedAttempt.id));

  await tx
    .select({id: steps.id})
    .from(steps)
    .where(inArray(steps.jobExecutionId, runJobExecutionIds))
    .orderBy(asc(steps.jobExecutionId), asc(steps.position))
    .for('update');

  const jobRows = await tx
    .select()
    .from(jobs)
    .where(eq(jobs.workflowRunAttemptId, lockedAttempt.id))
    .orderBy(asc(jobs.position), asc(jobs.id))
    .for('update');

  const changedJobs: Job[] = [];
  for (const jobRow of jobRows) {
    const finalized = await finalizeCancelledListenerEvents(tx, jobRow.id, spec);
    listenerEventOutcomes.honored += finalized.honored;
    listenerEventOutcomes.abandoned += finalized.abandoned;

    if (isJobTerminal(jobRow.status)) continue;

    const updated = await updateJobStatusAtVersion(tx, {
      jobId: jobRow.id,
      status: spec.terminalStatus,
      expectedVersion: jobRow.version,
      statusReason: spec.statusReason,
    });
    if (updated?.changed) changedJobs.push(updated.job);

    if (jobRow.mode === 'listening') {
      await tx
        .update(jobs)
        .set({listenerStatus: 'resolved', resolutionReason: 'cancelled', updatedAt: new Date()})
        .where(eq(jobs.id, jobRow.id));
    }

    const terminatedExecutions = await tx
      .update(jobExecutions)
      .set({
        status: spec.terminalStatus,
        statusReason: spec.statusReason,
        version: sql`${jobExecutions.version} + 1`,
        updatedAt: new Date(),
        finishedAt: sql`now()`,
        ...(spec.markExecutionTimedOut ? {timedOutAt: sql`now()`} : {}),
      })
      .where(
        and(
          eq(jobExecutions.jobId, jobRow.id),
          notInArray(jobExecutions.status, TERMINAL_EXECUTION_STATUSES),
        ),
      )
      .returning({
        id: jobExecutions.id,
        jobId: jobExecutions.jobId,
        status: jobExecutions.status,
        finishedAt: jobExecutions.finishedAt,
        statusReason: jobExecutions.statusReason,
        statusReasonMessage: jobExecutions.statusReasonMessage,
      });
    for (const jobExecution of terminatedExecutions) {
      await writeJobExecutionTerminatedOutbox(tx, {
        jobId: jobExecution.jobId,
        jobExecutionId: jobExecution.id,
        status: jobExecution.status,
        finishedAt: jobExecution.finishedAt,
        statusReason: jobExecution.statusReason,
        statusReasonMessage: jobExecution.statusReasonMessage,
      });
      await bulkUpdateStepStatuses(
        {jobExecutionId: jobExecution.id, status: spec.terminalStatus},
        tx,
      );
    }
  }

  await tx
    .update(workflowRunAttempts)
    .set({
      status: spec.terminalStatus,
      version: sql`${workflowRunAttempts.version} + 1`,
      updatedAt: new Date(),
      finishedAt: sql`now()`,
    })
    .where(
      and(
        eq(workflowRunAttempts.id, lockedAttempt.id),
        notInArray(workflowRunAttempts.status, TERMINAL_WORKFLOW_RUN_STATUSES),
      ),
    );

  const [terminatedRunRow] = await tx
    .update(workflowRuns)
    .set({
      status: spec.terminalStatus,
      version: sql`${workflowRuns.version} + 1`,
      updatedAt: new Date(),
      finishedAt: sql`now()`,
    })
    .where(
      and(
        eq(workflowRuns.id, lockedRun.id),
        notInArray(workflowRuns.status, TERMINAL_WORKFLOW_RUN_STATUSES),
      ),
    )
    .returning();

  const run = toWorkflowRun(terminatedRunRow ?? lockedRun);
  await writeWorkflowsOutboxEvent(tx, {
    type: WORKFLOWS_WORKFLOW_RUN_TERMINATED,
    payload: {
      workflowRunId: run.id,
      workflowRunAttemptId: lockedAttempt.id,
      projectId: run.projectId,
      status: spec.terminalStatus,
    },
  });
  if (spec.emitCancelledEvent) {
    await writeWorkflowsOutboxEvent(tx, {
      type: WORKFLOWS_WORKFLOW_RUN_CANCELLED,
      payload: {
        workflowRunId: run.id,
        workflowRunAttemptId: lockedAttempt.id,
        projectId: run.projectId,
      },
    });
  }

  return {run, changedJobs, listenerEventOutcomes};
}

export async function failWorkflowRunAsTimedOut(
  params: FailWorkflowRunAsTimedOutParams,
): Promise<WorkflowRun> {
  const result = await db().transaction(async (tx) => {
    const [attemptReference] = await tx
      .select()
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.id, params.runAttemptId))
      .limit(1);
    if (!attemptReference) throw new WorkflowRunNotFoundError(params.runAttemptId);

    // Keep timeout aligned with cancellation and listener drain: lock the run,
    // then the attempt, before any job or listener-event rows.
    const lockedRun = await lockWorkflowRun(attemptReference.workflowRunId, tx);
    if (!lockedRun) throw new WorkflowRunNotFoundError(attemptReference.workflowRunId);
    const [lockedAttempt] = await tx
      .select()
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.id, params.runAttemptId))
      .limit(1)
      .for('update');
    if (!lockedAttempt) throw new WorkflowRunNotFoundError(params.runAttemptId);
    if (isWorkflowRunTerminal(lockedRun.status)) {
      return {run: toWorkflowRun(lockedRun), changedJobs: [], changed: false};
    }

    const result = await terminateRunAttempt(tx, {
      lockedRun,
      lockedAttempt,
      spec: {
        terminalStatus: 'failed',
        statusReason: 'timed_out',
        markExecutionTimedOut: true,
        emitCancelledEvent: false,
      },
    });
    return {...result, changed: true};
  });

  if (result.changed) recordWorkflowRunStatusChanged(result.run.status);
  for (const job of result.changedJobs) recordWorkflowJobStatusChanged(job.status);
  return result.run;
}

export async function cancelWorkflowRun(params: CancelWorkflowRunParams): Promise<WorkflowRun> {
  const result = await db().transaction(async (tx) => {
    const lockedRun = await lockWorkflowRun(params.workflowRunId, tx);

    if (!lockedRun) {
      throw new WorkflowRunNotFoundError(params.workflowRunId);
    }
    if (isWorkflowRunTerminal(lockedRun.status)) {
      throw new WorkflowRunNotCancellableError(lockedRun.id, lockedRun.status);
    }

    const [lockedAttempt] = await tx
      .select()
      .from(workflowRunAttempts)
      .where(
        and(
          eq(workflowRunAttempts.workflowRunId, lockedRun.id),
          eq(workflowRunAttempts.attempt, lockedRun.currentAttempt),
        ),
      )
      .limit(1)
      .for('update');
    if (!lockedAttempt) {
      throw new Error(
        `Current attempt ${lockedRun.currentAttempt} missing for run ${lockedRun.id}`,
      );
    }

    return terminateRunAttempt(tx, {
      lockedRun,
      lockedAttempt,
      spec: {
        terminalStatus: 'cancelled',
        statusReason: 'run_cancelled',
        markExecutionTimedOut: false,
        emitCancelledEvent: true,
      },
    });
  });

  recordWorkflowRunStatusChanged(result.run.status);
  for (const job of result.changedJobs) recordWorkflowJobStatusChanged(job.status);
  if (result.listenerEventOutcomes.abandoned > 0) {
    recordWorkflowListenerEventOutcome(
      'abandoned',
      'cancelled',
      result.listenerEventOutcomes.abandoned,
    );
  }

  return result.run;
}

export interface UpdateWorkflowRunStatusParams {
  workflowRunId?: string;
  workflowRunAttemptId?: string;
  status: WorkflowRunStatus;
  expectedVersion: number;
}

export async function updateWorkflowRunStatus(
  params: UpdateWorkflowRunStatusParams,
): Promise<WorkflowRun> {
  const result = await db().transaction(async (tx) => {
    const target = await loadWorkflowRunStatusTarget(params, tx);
    const attemptRow = await updateWorkflowRunAttemptStatus(target.attempt.id, params, tx);
    if (!attemptRow) return resolveWorkflowRunStatusConflict(target, params, tx);

    const shouldMirror = target.run.currentAttempt === attemptRow.attempt;
    const run = await mirrorWorkflowRunStatus(
      target.run,
      attemptRow.version,
      params,
      shouldMirror,
      tx,
    );
    await writeRunTerminatedIfNeeded(run, attemptRow.id, shouldMirror, tx);
    return {run, changed: true};
  });

  if (result.changed) recordWorkflowRunStatusChanged(result.run.status);

  return result.run;
}

async function loadWorkflowRunStatusTarget(params: UpdateWorkflowRunStatusParams, tx: Tx) {
  const [attemptRef] = params.workflowRunAttemptId
    ? await tx
        .select({workflowRunId: workflowRunAttempts.workflowRunId})
        .from(workflowRunAttempts)
        .where(eq(workflowRunAttempts.id, params.workflowRunAttemptId))
        .limit(1)
    : [];
  const requestedId = params.workflowRunId ?? params.workflowRunAttemptId ?? '';
  const lockedRun = await lockWorkflowRun(
    attemptRef?.workflowRunId ?? params.workflowRunId ?? '',
    tx,
  );
  if (!lockedRun) throw new WorkflowRunNotFoundError(requestedId);

  const [lockedAttempt] = await tx
    .select()
    .from(workflowRunAttempts)
    .where(
      params.workflowRunAttemptId
        ? eq(workflowRunAttempts.id, params.workflowRunAttemptId)
        : and(
            eq(workflowRunAttempts.workflowRunId, lockedRun.id),
            eq(workflowRunAttempts.attempt, lockedRun.currentAttempt),
          ),
    )
    .limit(1)
    .for('update');
  if (!lockedAttempt) throw new WorkflowRunNotFoundError(requestedId);
  return {run: lockedRun, attempt: lockedAttempt};
}

async function updateWorkflowRunAttemptStatus(
  attemptId: string,
  params: UpdateWorkflowRunStatusParams,
  tx: Tx,
) {
  const [attemptRow] = await tx
    .update(workflowRunAttempts)
    .set({
      status: params.status,
      version: sql`${workflowRunAttempts.version} + 1`,
      updatedAt: new Date(),
      ...(params.status === 'running'
        ? {startedAt: sql`coalesce(${workflowRunAttempts.startedAt}, now())`}
        : {}),
      ...(isWorkflowRunTerminal(params.status) ? {finishedAt: sql`now()`} : {}),
    })
    .where(
      and(
        eq(workflowRunAttempts.id, attemptId),
        eq(workflowRunAttempts.version, params.expectedVersion),
        notInArray(workflowRunAttempts.status, TERMINAL_WORKFLOW_RUN_STATUSES),
      ),
    )
    .returning();
  return attemptRow;
}

async function resolveWorkflowRunStatusConflict(
  target: Awaited<ReturnType<typeof loadWorkflowRunStatusTarget>>,
  params: UpdateWorkflowRunStatusParams,
  tx: Tx,
) {
  const [existing] = await tx
    .select()
    .from(workflowRunAttempts)
    .where(eq(workflowRunAttempts.id, target.attempt.id))
    .limit(1);
  if (existing && (existing.status === params.status || isWorkflowRunTerminal(existing.status))) {
    return {run: {...toWorkflowRun(target.run), version: existing.version}, changed: false};
  }
  throw new Error(
    `Optimistic lock failure: run attempt ${target.attempt.id} version ${params.expectedVersion}`,
  );
}

async function mirrorWorkflowRunStatus(
  runRow: typeof workflowRuns.$inferSelect,
  attemptVersion: number,
  params: UpdateWorkflowRunStatusParams,
  shouldMirror: boolean,
  tx: Tx,
): Promise<WorkflowRun> {
  if (!shouldMirror) return {...toWorkflowRun(runRow), version: attemptVersion};
  const [updated] = await tx
    .update(workflowRuns)
    .set({
      status: params.status,
      version: sql`${workflowRuns.version} + 1`,
      updatedAt: new Date(),
      ...(params.status === 'running'
        ? {startedAt: sql`coalesce(${workflowRuns.startedAt}, now())`}
        : {}),
      ...(isWorkflowRunTerminal(params.status) ? {finishedAt: sql`now()`} : {}),
    })
    .where(eq(workflowRuns.id, runRow.id))
    .returning();
  return {...toWorkflowRun(updated ?? runRow), version: attemptVersion};
}

async function writeRunTerminatedIfNeeded(
  run: WorkflowRun,
  attemptId: string,
  shouldMirror: boolean,
  tx: Tx,
): Promise<void> {
  if (!shouldMirror || !isWorkflowRunTerminal(run.status)) return;
  await writeWorkflowsOutboxEvent(tx, {
    type: WORKFLOWS_WORKFLOW_RUN_TERMINATED,
    payload: {
      workflowRunId: run.id,
      workflowRunAttemptId: attemptId,
      projectId: run.projectId,
      status: run.status,
    },
  });
}
