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
import {recordWorkflowJobStatusChanged, recordWorkflowRunStatusChanged} from '#metrics/instance.js';
import {db, type Tx} from '../db.js';
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
): Promise<{run: WorkflowRun; changedJobs: Job[]}> {
  const {lockedRun, lockedAttempt, spec} = params;

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
      .returning();
    for (const jobExecution of terminatedExecutions) {
      await writeJobExecutionTerminatedOutbox(tx, {
        jobId: jobExecution.jobId,
        jobExecutionId: jobExecution.id,
        status: jobExecution.status,
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

  return {run, changedJobs};
}

export async function failWorkflowRunAsTimedOut(
  params: FailWorkflowRunAsTimedOutParams,
): Promise<WorkflowRun> {
  const result = await db().transaction(async (tx) => {
    const [lockedAttempt] = await tx
      .select()
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.id, params.runAttemptId))
      .limit(1)
      .for('update');
    if (!lockedAttempt) throw new WorkflowRunNotFoundError(params.runAttemptId);

    const lockedRun = await lockWorkflowRun(lockedAttempt.workflowRunId, tx);
    if (!lockedRun) throw new WorkflowRunNotFoundError(lockedAttempt.workflowRunId);
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
    const [attemptRef] = params.workflowRunAttemptId
      ? await tx
          .select({
            id: workflowRunAttempts.id,
            workflowRunId: workflowRunAttempts.workflowRunId,
          })
          .from(workflowRunAttempts)
          .where(eq(workflowRunAttempts.id, params.workflowRunAttemptId))
          .limit(1)
      : [];

    const workflowRunId = attemptRef?.workflowRunId ?? params.workflowRunId ?? '';
    const lockedRun = await lockWorkflowRun(workflowRunId, tx);

    if (!lockedRun) {
      throw new WorkflowRunNotFoundError(params.workflowRunId ?? params.workflowRunAttemptId ?? '');
    }

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

    if (!lockedAttempt) {
      throw new WorkflowRunNotFoundError(params.workflowRunId ?? params.workflowRunAttemptId ?? '');
    }

    const target = {run: lockedRun, attempt: lockedAttempt};

    const rows = await tx
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
          eq(workflowRunAttempts.id, target.attempt.id),
          eq(workflowRunAttempts.version, params.expectedVersion),
          notInArray(workflowRunAttempts.status, TERMINAL_WORKFLOW_RUN_STATUSES),
        ),
      )
      .returning();

    const attemptRow = rows[0];
    if (!attemptRow) {
      const existing = await tx
        .select()
        .from(workflowRunAttempts)
        .where(eq(workflowRunAttempts.id, target.attempt.id))
        .limit(1);
      const existingRow = existing[0];
      if (
        existingRow &&
        (existingRow.status === params.status || isWorkflowRunTerminal(existingRow.status))
      ) {
        return {
          run: {...toWorkflowRun(target.run), version: existingRow.version},
          changed: false,
        };
      }
      throw new Error(
        `Optimistic lock failure: run attempt ${target.attempt.id} version ${params.expectedVersion}`,
      );
    }

    const shouldMirror = target.run.currentAttempt === attemptRow.attempt;
    const [runRow] = shouldMirror
      ? await tx
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
          .where(eq(workflowRuns.id, target.run.id))
          .returning()
      : [target.run];

    const run = {...toWorkflowRun(runRow ?? target.run), version: attemptRow.version};

    if (shouldMirror && isWorkflowRunTerminal(run.status)) {
      await writeWorkflowsOutboxEvent(tx, {
        type: WORKFLOWS_WORKFLOW_RUN_TERMINATED,
        payload: {
          workflowRunId: run.id,
          workflowRunAttemptId: attemptRow.id,
          projectId: run.projectId,
          status: run.status,
        },
      });
    }

    return {run, changed: true};
  });

  if (result.changed) recordWorkflowRunStatusChanged(result.run.status);

  return result.run;
}
