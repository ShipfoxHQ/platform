import type {LogOutcomeDto} from '@shipfox/api-workflows-dto';
import {captureException} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {and, asc, count, desc, eq, gte, inArray, sql} from 'drizzle-orm';
import {
  assertWorkflowDiagnosticSize,
  assertWorkflowStepAttemptInvocationCount,
  boundedLegacyDiagnosticValue,
} from '#core/diagnostics.js';
import type {
  PersistedEvaluationTraceEntry,
  Step,
  StepAttempt,
  StepAttemptInvocation,
  StepAttemptStatus,
  StepStatus,
  StepStatusReason,
} from '#core/entities/step.js';
import {deriveCompletion, isTerminal} from '#core/step-transition/decide-step-transition.js';
import {
  discardPendingCheckoutRenewalSubject,
  promoteCheckoutRenewalSubject,
} from '../checkout-renewal-subjects.js';
import {db, type Tx} from '../db.js';
import {checkoutRenewalSubjects} from '../schema/checkout-renewal-subjects.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobs} from '../schema/jobs.js';
import {stepAttempts, toStepAttempt} from '../schema/step-attempts.js';
import {steps, toStep} from '../schema/steps.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {workflowRuns} from '../schema/workflow-runs.js';
import {writeJobStepsSettledOutbox, writeStepAttemptTerminatedOutbox} from './outbox.js';
import {NON_TERMINAL_STEP_STATUS_FILTER} from './shared.js';

export async function getStepByIdForJobExecution(params: {
  stepId: string;
  jobExecutionId: string;
}): Promise<Step | undefined> {
  const rows = await db()
    .select()
    .from(steps)
    .where(and(eq(steps.id, params.stepId), eq(steps.jobExecutionId, params.jobExecutionId)))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toStep(row);
}

export async function getStepById(stepId: string): Promise<Step | undefined> {
  const rows = await db().select().from(steps).where(eq(steps.id, stepId)).limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toStep(row);
}

export interface StepAttemptDetail {
  workflowRunId: string;
  workflowRunAttemptId: string;
  workflowRunAttempt: number;
  jobId: string;
  jobExecutionId: string;
  step: Step;
  attempt: StepAttempt;
}

export interface JobExecutionFailureOrigin {
  jobExecutionId: string;
  stepId: string;
  stepName: string;
  stepStatus: StepStatus;
  stepAttempt: number;
  stepError: Record<string, unknown> | null;
  attemptStatus: StepAttemptStatus | null;
  attemptError: Record<string, unknown> | null;
  attemptExitCode: number | null;
}

/**
 * Read only the current attempt for the most relevant step. The terminal job event identifies
 * the execution, so this intentionally avoids hydrating the execution's complete attempt
 * history. If no attempt was dispatched, the first step still gives the projection a stable
 * troubleshooting origin for failures that happened before step work started.
 */
export async function getJobExecutionFailureOrigin(
  jobExecutionId: string,
): Promise<JobExecutionFailureOrigin | undefined> {
  const rows = await db()
    .select({
      jobExecutionId: jobExecutions.id,
      stepId: steps.id,
      stepName: steps.name,
      stepStatus: steps.status,
      stepAttempt: steps.currentAttempt,
      stepError: steps.error,
      attemptStatus: stepAttempts.status,
      attemptError: stepAttempts.error,
      attemptExitCode: stepAttempts.exitCode,
    })
    .from(jobExecutions)
    .innerJoin(steps, eq(steps.jobExecutionId, jobExecutions.id))
    .leftJoin(
      stepAttempts,
      and(eq(stepAttempts.stepId, steps.id), eq(stepAttempts.attempt, steps.currentAttempt)),
    )
    .where(eq(jobExecutions.id, jobExecutionId))
    .orderBy(
      desc(
        sql<number>`case when ${steps.status} = 'failed' or ${stepAttempts.status} = 'failed' or ${steps.statusReason} = 'condition_errored' then 1 else 0 end`,
      ),
      asc(steps.position),
      asc(steps.id),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;

  return {
    ...row,
    stepError: (row.stepError as Record<string, unknown> | null) ?? null,
    attemptError: (row.attemptError as Record<string, unknown> | null) ?? null,
    attemptStatus: row.attemptStatus === null ? null : (row.attemptStatus as StepAttemptStatus),
    attemptExitCode: row.attemptExitCode ?? null,
  };
}

export async function getStepAttemptDetail(params: {
  stepId: string;
  attempt: number;
  workspaceId?: string | undefined;
}): Promise<StepAttemptDetail | undefined> {
  const conditions = [
    eq(stepAttempts.stepId, params.stepId),
    eq(stepAttempts.attempt, params.attempt),
  ];
  if (params.workspaceId) conditions.push(eq(workflowRuns.workspaceId, params.workspaceId));
  const rows = await db()
    .select({
      workflowRunId: workflowRuns.id,
      workflowRunAttemptId: workflowRunAttempts.id,
      workflowRunAttempt: workflowRunAttempts.attempt,
      jobId: jobs.id,
      jobExecutionId: jobExecutions.id,
      step: steps,
      stepAttempt: stepAttempts,
    })
    .from(stepAttempts)
    .innerJoin(steps, eq(stepAttempts.stepId, steps.id))
    .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(and(...conditions))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;

  return {
    workflowRunId: row.workflowRunId,
    workflowRunAttemptId: row.workflowRunAttemptId,
    workflowRunAttempt: row.workflowRunAttempt,
    jobId: row.jobId,
    jobExecutionId: row.jobExecutionId,
    step: toStep(row.step),
    attempt: toStepAttempt(row.stepAttempt),
  };
}

export async function getLatestStepAttempt(params: {
  stepId: string;
  workspaceId: string;
}): Promise<number | undefined> {
  const rows = await db()
    .select({attempt: stepAttempts.attempt})
    .from(stepAttempts)
    .innerJoin(steps, eq(stepAttempts.stepId, steps.id))
    .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(
      and(eq(stepAttempts.stepId, params.stepId), eq(workflowRuns.workspaceId, params.workspaceId)),
    )
    .orderBy(desc(stepAttempts.attempt))
    .limit(1);

  return rows[0]?.attempt;
}

export async function getStepsByJobId(jobId: string): Promise<Step[]> {
  const rows = await db()
    .select({step: steps})
    .from(steps)
    .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
    .where(eq(jobExecutions.jobId, jobId))
    .orderBy(asc(steps.position));
  return rows.map((row) => toStep(row.step));
}

export async function getStepsByJobExecutionId(jobExecutionId: string): Promise<Step[]> {
  const rows = await db()
    .select()
    .from(steps)
    .where(eq(steps.jobExecutionId, jobExecutionId))
    .orderBy(asc(steps.position));
  return rows.map(toStep);
}

export interface BulkUpdateStepStatusesParams {
  jobExecutionId: string;
  status: Extract<StepStatus, 'failed' | 'cancelled'>;
}

export async function bulkUpdateStepStatuses(
  params: BulkUpdateStepStatusesParams,
  tx?: Tx,
): Promise<void> {
  if (!tx) {
    await db().transaction((transaction) => bulkUpdateStepStatuses(params, transaction));
    return;
  }

  await tx
    .update(steps)
    .set({
      status: params.status,
      statusReason: null,
      updatedAt: new Date(),
    })
    .where(and(eq(steps.jobExecutionId, params.jobExecutionId), NON_TERMINAL_STEP_STATUS_FILTER));

  await runBestEffortCheckoutRenewalSubjectMaintenance(
    tx,
    {jobExecutionId: params.jobExecutionId},
    async (renewalTx) => {
      await renewalTx
        .delete(checkoutRenewalSubjects)
        .where(
          and(
            eq(checkoutRenewalSubjects.status, 'pending'),
            inArray(
              checkoutRenewalSubjects.stepId,
              renewalTx
                .select({id: steps.id})
                .from(steps)
                .where(eq(steps.jobExecutionId, params.jobExecutionId)),
            ),
          ),
        );
    },
  );

  // Finalize open attempt rows so a timed-out/cancelled sweep does not leave
  // phantom in-flight work for gate and restart logic.
  const finalizedAttempts = await tx
    .update(stepAttempts)
    .set({status: params.status, logOutcome: 'abandoned', finishedAt: new Date()})
    .from(steps)
    .where(
      and(
        eq(stepAttempts.stepId, steps.id),
        eq(steps.jobExecutionId, params.jobExecutionId),
        eq(stepAttempts.status, 'running'),
      ),
    )
    .returning({
      id: stepAttempts.id,
      stepId: stepAttempts.stepId,
      attempt: stepAttempts.attempt,
      logOutcome: stepAttempts.logOutcome,
    });

  if (finalizedAttempts.length > 0) {
    for (const attempt of finalizedAttempts) {
      await writeStepAttemptTerminatedOutbox(tx, {
        stepAttemptId: attempt.id,
        stepId: attempt.stepId,
        attempt: attempt.attempt,
        status: params.status,
        logOutcome: attempt.logOutcome ?? 'abandoned',
      });
    }
  }
}

// Per-step progression primitives. They take a mandatory `tx` because they only
// run inside the job-execution service's transaction, and every write guards on
// the never-downgrade predicate so a late or duplicate write cannot overwrite an
// already-terminal row.

export async function getStepsByJobExecutionIdForUpdate(
  jobExecutionId: string,
  tx: Tx,
): Promise<Step[]> {
  const rows = await tx
    .select()
    .from(steps)
    .where(eq(steps.jobExecutionId, jobExecutionId))
    .orderBy(asc(steps.position))
    .for('update');
  return rows.map(toStep);
}

export async function getStepAttemptsByJobExecutionId(
  jobExecutionId: string,
  tx: Tx,
): Promise<StepAttempt[]> {
  const rows = await tx
    .select()
    .from(stepAttempts)
    .where(eq(stepAttempts.jobExecutionId, jobExecutionId))
    .orderBy(asc(stepAttempts.executionOrder), asc(stepAttempts.id));
  return rows.map(toStepAttempt);
}

export interface MarkStepRunningParams {
  jobExecutionId: string;
  stepId: string;
}

export async function markStepRunning(params: MarkStepRunningParams, tx: Tx): Promise<Step | null> {
  const rows = await tx
    .update(steps)
    .set({
      status: 'running',
      statusReason: null,
      evaluationTrace: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(steps.id, params.stepId),
        eq(steps.jobExecutionId, params.jobExecutionId),
        NON_TERMINAL_STEP_STATUS_FILTER,
      ),
    )
    .returning();
  const row = rows[0];
  if (!row) return null;
  const step = toStep(row);
  // Open the attempt this dispatch runs. onConflictDoNothing makes a racing
  // re-dispatch a no-op against the unique (step_id, attempt) anchor; normal
  // re-delivery returns the already-running step without calling this.
  await insertRunningStepAttempt(
    {
      jobExecutionId: step.jobExecutionId,
      stepId: step.id,
      attempt: step.currentAttempt,
      config: step.config,
    },
    tx,
  );
  return step;
}

export interface DispatchStepWithCompletedConfigParams {
  jobExecutionId: string;
  stepId: string;
  attempt: number;
  stepAttemptId?: string | undefined;
  config: Record<string, unknown>;
  evaluationTrace: readonly PersistedEvaluationTraceEntry[] | null;
}

export async function dispatchStepWithCompletedConfig(
  params: DispatchStepWithCompletedConfigParams,
  tx: Tx,
): Promise<Step | null> {
  assertWorkflowDiagnosticSize('config', params.config);
  assertWorkflowDiagnosticSize('evaluation_trace', params.evaluationTrace);

  const rows = await tx
    .update(steps)
    .set({
      status: 'running',
      statusReason: null,
      evaluationTrace: null,
      config: params.config,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(steps.id, params.stepId),
        eq(steps.jobExecutionId, params.jobExecutionId),
        eq(steps.currentAttempt, params.attempt),
        NON_TERMINAL_STEP_STATUS_FILTER,
      ),
    )
    .returning();
  const row = rows[0];
  if (!row) return null;
  const step = toStep(row);
  // The attempt row is opened before dispatch when a session claim needs its
  // id. Refresh that same row with the completed config and trace instead of
  // opening a second row after the claim.
  const attemptFilter =
    params.stepAttemptId === undefined
      ? and(
          eq(stepAttempts.stepId, step.id),
          eq(stepAttempts.attempt, params.attempt),
          eq(stepAttempts.status, 'running'),
        )
      : and(
          eq(stepAttempts.id, params.stepAttemptId),
          eq(stepAttempts.stepId, step.id),
          eq(stepAttempts.attempt, params.attempt),
          eq(stepAttempts.status, 'running'),
        );
  await tx
    .update(stepAttempts)
    .set({
      config: params.config,
      evaluationTrace: params.evaluationTrace ?? null,
    })
    .where(attemptFilter);
  return step;
}

export interface MarkStepSkippedParams {
  jobExecutionId: string;
  stepId: string;
  statusReason: StepStatusReason;
  evaluationTrace: readonly PersistedEvaluationTraceEntry[];
}

export async function markStepSkipped(params: MarkStepSkippedParams, tx: Tx): Promise<Step | null> {
  assertWorkflowDiagnosticSize('evaluation_trace', params.evaluationTrace);

  const rows = await tx
    .update(steps)
    .set({
      status: 'skipped',
      statusReason: params.statusReason,
      evaluationTrace: params.evaluationTrace,
      error: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(steps.id, params.stepId),
        eq(steps.jobExecutionId, params.jobExecutionId),
        eq(steps.status, 'pending'),
      ),
    )
    .returning();
  const row = rows[0];
  return row ? toStep(row) : null;
}

export async function settleJobFailed(
  tx: Tx,
  params: {
    jobId: string;
    jobExecutionId: string;
    failedStepId: string;
    error: Record<string, unknown>;
  },
): Promise<'succeeded' | 'failed' | null> {
  await applyStepResult(
    {
      jobExecutionId: params.jobExecutionId,
      stepId: params.failedStepId,
      status: 'failed',
      error: params.error,
    },
    tx,
  );

  const after = await getStepsByJobExecutionIdForUpdate(params.jobExecutionId, tx);
  if (!after.every((step) => isTerminal(step.status))) return null;

  const status = deriveCompletion(after);
  await writeJobStepsSettledOutbox(tx, {
    jobId: params.jobId,
    jobExecutionId: params.jobExecutionId,
    status,
  });
  return status;
}

export interface InsertRunningStepAttemptParams {
  jobExecutionId: string;
  stepId: string;
  attempt: number;
  config?: Record<string, unknown> | null;
  evaluationTrace?: readonly PersistedEvaluationTraceEntry[] | null;
  invocations?: readonly StepAttemptInvocation[] | undefined;
  allowLegacyOversizedDiagnostics?: boolean | undefined;
}

export async function insertRunningStepAttempt(
  params: InsertRunningStepAttemptParams,
  tx: Tx,
): Promise<string | undefined> {
  let config = params.config;
  let evaluationTrace = params.evaluationTrace;
  if (params.allowLegacyOversizedDiagnostics === true) {
    config = boundedLegacyDiagnosticValue('config', config);
    evaluationTrace = boundedLegacyDiagnosticValue('evaluation_trace', evaluationTrace);
  } else {
    assertWorkflowDiagnosticSize('config', config);
    assertWorkflowDiagnosticSize('evaluation_trace', evaluationTrace);
  }
  assertWorkflowStepAttemptInvocationCount(params.invocations?.length ?? 0);

  const [{nextExecutionOrder} = {nextExecutionOrder: 1}] = await tx
    .select({
      nextExecutionOrder: sql<number>`coalesce(max(${stepAttempts.executionOrder}), 0) + 1`,
    })
    .from(stepAttempts)
    .where(eq(stepAttempts.jobExecutionId, params.jobExecutionId));

  const rows = await tx
    .insert(stepAttempts)
    .values({
      jobExecutionId: params.jobExecutionId,
      stepId: params.stepId,
      attempt: params.attempt,
      executionOrder: nextExecutionOrder,
      status: 'running',
      config: config ?? null,
      evaluationTrace: evaluationTrace ?? null,
      invocations: params.invocations ?? [],
    })
    .onConflictDoNothing({target: [stepAttempts.stepId, stepAttempts.attempt]})
    .returning({id: stepAttempts.id});

  const inserted = rows[0]?.id;
  if (inserted !== undefined) return inserted;

  const [existing] = await tx
    .select({id: stepAttempts.id, status: stepAttempts.status})
    .from(stepAttempts)
    .where(and(eq(stepAttempts.stepId, params.stepId), eq(stepAttempts.attempt, params.attempt)))
    .limit(1);
  return existing?.status === 'running' ? existing.id : undefined;
}

export interface FinishStepAttemptParams {
  stepId: string;
  attempt: number;
  status: Exclude<StepAttemptStatus, 'running'>;
  error?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  response?: string | null;
  exitCode?: number | null;
  logOutcome: LogOutcomeDto;
  gateResult?: Record<string, unknown> | null;
  restartFeedback?: string | null;
}

async function runBestEffortCheckoutRenewalSubjectMaintenance(
  tx: Tx,
  context: {jobExecutionId?: string; stepId?: string; attempt?: number},
  operation: (tx: Tx) => Promise<void>,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      // Use a savepoint so a missing or unhealthy derived-state table cannot abort
      // the transaction that records the authoritative step transition. A second
      // savepoint gives transient maintenance failures one chance to recover.
      await tx.transaction(operation);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  logger().error(
    {error: lastError, ...context},
    'Checkout renewal subject maintenance failed; continuing step transition',
  );
  captureException(lastError);
}

// Finalize the running attempt to a terminal state. The `status='running'` guard
// makes this idempotent: a duplicate report finds the attempt already terminal
// and updates nothing (never-downgrade for the audit row).
export async function finishStepAttempt(params: FinishStepAttemptParams, tx: Tx): Promise<void> {
  assertWorkflowDiagnosticSize('output', params.output);
  assertWorkflowDiagnosticSize('response', params.response);
  assertWorkflowDiagnosticSize('error', params.error);
  assertWorkflowDiagnosticSize('gate_result', params.gateResult);
  assertWorkflowDiagnosticSize('restart_feedback', params.restartFeedback);

  const rows = await tx
    .update(stepAttempts)
    .set({
      status: params.status,
      output: params.output ?? null,
      response: params.response ?? null,
      error: params.error ?? null,
      exitCode: params.exitCode ?? null,
      logOutcome: params.logOutcome,
      gateResult: params.gateResult ?? null,
      restartFeedback: params.restartFeedback ?? null,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(stepAttempts.stepId, params.stepId),
        eq(stepAttempts.attempt, params.attempt),
        eq(stepAttempts.status, 'running'),
      ),
    )
    .returning({
      id: stepAttempts.id,
      stepId: stepAttempts.stepId,
      attempt: stepAttempts.attempt,
      logOutcome: stepAttempts.logOutcome,
    });

  const row = rows[0];
  if (!row) return;

  await runBestEffortCheckoutRenewalSubjectMaintenance(
    tx,
    {stepId: row.stepId, attempt: row.attempt},
    async (renewalTx) => {
      const [pendingSubject] = await renewalTx
        .select({id: checkoutRenewalSubjects.id})
        .from(checkoutRenewalSubjects)
        .where(
          and(
            eq(checkoutRenewalSubjects.stepId, row.stepId),
            eq(checkoutRenewalSubjects.attempt, row.attempt),
            eq(checkoutRenewalSubjects.status, 'pending'),
          ),
        )
        .limit(1);
      if (!pendingSubject) return;

      if (params.status === 'succeeded') {
        await promoteCheckoutRenewalSubject({stepId: row.stepId, attempt: row.attempt}, renewalTx);
      } else {
        await discardPendingCheckoutRenewalSubject(
          {stepId: row.stepId, attempt: row.attempt},
          renewalTx,
        );
      }
    },
  );

  await writeStepAttemptTerminatedOutbox(tx, {
    stepAttemptId: row.id,
    stepId: row.stepId,
    attempt: row.attempt,
    status: params.status,
    logOutcome: row.logOutcome ?? params.logOutcome,
  });
}

export interface RewindStepsToPendingParams {
  jobExecutionId: string;
  fromPosition: number;
}

// Restart-only: rewind every step at or after `fromPosition` back to pending,
// clearing its result and bumping both `version` and `current_attempt` so the next
// dispatch opens a fresh attempt. This DELIBERATELY bypasses the never-downgrade
// guard used everywhere else. It is the one place that resurrects terminal steps,
// so it must only be called from the durable-restart path, never the ordinary
// report path. It must run in the same transaction as the failed-attempt write.
export async function rewindStepsToPending(
  params: RewindStepsToPendingParams,
  tx: Tx,
): Promise<void> {
  await tx
    .update(steps)
    .set({
      status: 'pending',
      statusReason: null,
      error: null,
      version: sql`${steps.version} + 1`,
      currentAttempt: sql`${steps.currentAttempt} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(steps.jobExecutionId, params.jobExecutionId),
        gte(steps.position, params.fromPosition),
      ),
    );
}

// Count a single step's own attempts. Used to bound the restart cap on the
// gating step's actual executions: `steps.current_attempt` can't be used for
// the cap because a rewind also bumps it for downstream steps swept into the
// rewind range (which would inflate a later gate's cap in a multi-gate job).
export async function countStepAttempts(stepId: string, tx: Tx): Promise<number> {
  const rows = await tx
    .select({total: count()})
    .from(stepAttempts)
    .where(eq(stepAttempts.stepId, stepId));
  return Number(rows[0]?.total ?? 0);
}

export async function getStepAttempts(jobId: string): Promise<StepAttempt[]> {
  const rows = await db()
    .select({stepAttempt: stepAttempts})
    .from(stepAttempts)
    .innerJoin(steps, eq(stepAttempts.stepId, steps.id))
    .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
    .where(eq(jobExecutions.jobId, jobId))
    .orderBy(asc(stepAttempts.executionOrder));
  return rows.map((row) => toStepAttempt(row.stepAttempt));
}

/**
 * Lists only the step attempt ids of a job, without materializing the full
 * attempt entities. The session release sweep only needs the ids to release
 * claims, so this keeps the per-job-terminated query off a full-row projection.
 */
export async function listStepAttemptIdsByJobId(jobId: string): Promise<string[]> {
  const rows = await db()
    .select({id: stepAttempts.id})
    .from(stepAttempts)
    .innerJoin(steps, eq(stepAttempts.stepId, steps.id))
    .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
    .where(eq(jobExecutions.jobId, jobId));
  return rows.map((row) => row.id);
}

export async function getStepAttemptsByJobIds(jobIds: string[]): Promise<StepAttempt[]> {
  if (jobIds.length === 0) return [];
  const rows = await db()
    .select({stepAttempt: stepAttempts, jobId: jobExecutions.jobId})
    .from(stepAttempts)
    .innerJoin(steps, eq(stepAttempts.stepId, steps.id))
    .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
    .where(inArray(jobExecutions.jobId, jobIds))
    .orderBy(asc(jobExecutions.jobId), asc(stepAttempts.executionOrder));
  return rows.map((row) => toStepAttempt(row.stepAttempt));
}

export interface ApplyStepResultParams {
  jobExecutionId: string;
  stepId: string;
  status: 'succeeded' | 'failed';
  error: Record<string, unknown> | null;
}

export async function applyStepResult(params: ApplyStepResultParams, tx: Tx): Promise<void> {
  assertWorkflowDiagnosticSize('error', params.error);

  await tx
    .update(steps)
    .set({
      status: params.status,
      statusReason: null,
      error: params.error ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(steps.id, params.stepId),
        eq(steps.jobExecutionId, params.jobExecutionId),
        NON_TERMINAL_STEP_STATUS_FILTER,
      ),
    );
}

export interface CancelRemainingStepsParams {
  jobExecutionId: string;
}

export async function cancelRemainingSteps(
  params: CancelRemainingStepsParams,
  tx: Tx,
): Promise<void> {
  await bulkUpdateStepStatuses({jobExecutionId: params.jobExecutionId, status: 'cancelled'}, tx);
}
