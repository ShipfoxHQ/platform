import {and, asc, count, eq, lte, or} from 'drizzle-orm';
import type {Step, StepAttempt, StepAttemptInvocation} from '#core/entities/step.js';
import {db, type Tx} from '../db.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobs} from '../schema/jobs.js';
import {type StepAttemptDb, stepAttempts, toStepAttempt} from '../schema/step-attempts.js';
import {type StepDb, steps, toStep} from '../schema/steps.js';
import {type ToolInvocationDb, toolInvocations} from '../schema/tool-invocations.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {workflowRuns} from '../schema/workflow-runs.js';

export interface EnqueueToolInvocationParams {
  stepId: string;
  stepAttemptId: string;
  jobExecutionId: string;
  workspaceId: string;
  dueAt: Date;
  callIndex?: number | undefined;
}

export const MAX_TOOL_STEP_CALLS_PER_ATTEMPT = 3;
export const INVOCATION_INTERRUPTED_ERROR_CODE = 'invocation_interrupted';

export interface ToolStepWorkflowContext {
  jobId: string;
  workflowRunId: string;
  workflowRunAttemptId: string;
  workspaceId: string;
  projectId: string;
  vars: Record<string, string> | null;
}

export interface ToolInvocationClaim {
  invocation: ToolInvocationDb;
  step: Step;
  attempt: StepAttempt;
  workflowContext: ToolStepWorkflowContext;
  interrupted: boolean;
}

export interface ClaimToolInvocationsResult {
  claims: ToolInvocationClaim[];
  requeued: number;
}

export interface ToolInvocationDepth {
  queued: number;
  inFlight: number;
}

export interface ClaimToolInvocationsParams {
  limit: number;
  now: Date;
  claimOwner: string;
  claimExpiresAt: Date;
}

// The unique step-attempt anchor makes this safe if a caller retries the same
// dispatch inside a transaction that has already opened the attempt.
export async function enqueueToolInvocation(
  params: EnqueueToolInvocationParams,
  tx: Tx,
): Promise<void> {
  await tx
    .insert(toolInvocations)
    .values({
      stepId: params.stepId,
      stepAttemptId: params.stepAttemptId,
      jobExecutionId: params.jobExecutionId,
      workspaceId: params.workspaceId,
      status: 'queued',
      callIndex: params.callIndex ?? 0,
      dueAt: params.dueAt,
    })
    .onConflictDoNothing({target: [toolInvocations.stepAttemptId]});
}

export function getToolInvocationsByJobExecutionId(
  jobExecutionId: string,
): Promise<ToolInvocationDb[]> {
  return db()
    .select()
    .from(toolInvocations)
    .where(eq(toolInvocations.jobExecutionId, jobExecutionId))
    .orderBy(asc(toolInvocations.callIndex), asc(toolInvocations.id));
}

export async function getToolInvocationDepth(): Promise<ToolInvocationDepth> {
  const rows = await db()
    .select({status: toolInvocations.status, count: count()})
    .from(toolInvocations)
    .where(or(eq(toolInvocations.status, 'queued'), eq(toolInvocations.status, 'in_flight')))
    .groupBy(toolInvocations.status);

  return {
    queued: rows.find((row) => row.status === 'queued')?.count ?? 0,
    inFlight: rows.find((row) => row.status === 'in_flight')?.count ?? 0,
  };
}

/**
 * Claims due invocations and reclaims expired calls in one short transaction.
 * Only the invocation row is selected with SKIP LOCKED so independent tool
 * steps can make progress concurrently.
 */
export function claimToolInvocations(
  params: ClaimToolInvocationsParams,
  tx?: Tx,
): Promise<ClaimToolInvocationsResult> {
  if (params.limit < 1) throw new Error(`Tool invocation claim limit must be positive`);
  if (tx) return claimToolInvocationsInTransaction(params, tx);
  return db().transaction((transaction) => claimToolInvocationsInTransaction(params, transaction));
}

export interface RetryToolInvocationParams {
  invocationId: string;
  stepAttemptId: string;
  claimOwner: string;
  callIndex: number;
  dueAt: Date;
  errorCode: string;
  finishedAt: Date;
  durationMs: number;
}

/** Returns false when another worker already settled or reclaimed the call. */
export function retryToolInvocation(params: RetryToolInvocationParams, tx?: Tx): Promise<boolean> {
  if (tx) return retryToolInvocationInTransaction(params, tx);
  return db().transaction((transaction) => retryToolInvocationInTransaction(params, transaction));
}

export interface SettleToolInvocationParams {
  invocationId: string;
  stepAttemptId: string;
  claimOwner: string;
  callIndex: number;
  outcome: 'success' | 'error';
  errorCode?: string | undefined;
  finishedAt: Date;
  durationMs: number;
}

/** Returns false when another worker already settled or reclaimed the call. */
export function settleToolInvocation(
  params: SettleToolInvocationParams,
  tx?: Tx,
): Promise<boolean> {
  if (tx) return settleToolInvocationInTransaction(params, tx);
  return db().transaction((transaction) => settleToolInvocationInTransaction(params, transaction));
}

interface ToolInvocationCandidate {
  invocation: ToolInvocationDb;
  step: StepDb;
  stepAttempt: StepAttemptDb;
  workflowContext: ToolStepWorkflowContext;
}

async function claimToolInvocationsInTransaction(
  params: ClaimToolInvocationsParams,
  tx: Tx,
): Promise<ClaimToolInvocationsResult> {
  const candidates = (await tx
    .select({
      invocation: toolInvocations,
      step: steps,
      stepAttempt: stepAttempts,
      workflowContext: {
        jobId: jobs.id,
        workflowRunId: workflowRuns.id,
        workflowRunAttemptId: workflowRunAttempts.id,
        workspaceId: workflowRuns.workspaceId,
        projectId: workflowRuns.projectId,
        vars: workflowRunAttempts.vars,
      },
    })
    .from(toolInvocations)
    .innerJoin(
      steps,
      and(
        eq(toolInvocations.stepId, steps.id),
        eq(toolInvocations.jobExecutionId, steps.jobExecutionId),
      ),
    )
    .innerJoin(
      stepAttempts,
      and(
        eq(toolInvocations.stepAttemptId, stepAttempts.id),
        eq(toolInvocations.stepId, stepAttempts.stepId),
        eq(toolInvocations.jobExecutionId, stepAttempts.jobExecutionId),
      ),
    )
    .innerJoin(jobExecutions, eq(toolInvocations.jobExecutionId, jobExecutions.id))
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(
      or(
        and(eq(toolInvocations.status, 'queued'), lte(toolInvocations.dueAt, params.now)),
        and(
          eq(toolInvocations.status, 'in_flight'),
          lte(toolInvocations.claimExpiresAt, params.now),
        ),
      ),
    )
    .orderBy(asc(toolInvocations.dueAt), asc(toolInvocations.id))
    .limit(params.limit)
    .for('update', {of: [toolInvocations], skipLocked: true})) as ToolInvocationCandidate[];

  const claims: ToolInvocationClaim[] = [];
  let requeued = 0;

  for (const candidate of candidates) {
    const result = await processToolInvocationCandidate(candidate, params, tx);
    if (result.claim) claims.push(result.claim);
    if (result.requeued) requeued += 1;
  }

  return {claims, requeued};
}

async function processToolInvocationCandidate(
  candidate: ToolInvocationCandidate,
  params: ClaimToolInvocationsParams,
  tx: Tx,
): Promise<{claim?: ToolInvocationClaim; requeued: boolean}> {
  const {invocation, step, stepAttempt} = candidate;
  if (step.type !== 'tool' || step.status !== 'running' || stepAttempt.status !== 'running') {
    await settleUnusableInvocation(candidate, params, tx);
    return {requeued: false};
  }

  if (invocation.status === 'in_flight') {
    return processExpiredInFlightInvocation(candidate, params, tx);
  }
  if (invocation.callIndex >= MAX_TOOL_STEP_CALLS_PER_ATTEMPT) {
    const claim = await claimInterruptedInvocation(candidate, params, tx);
    return claim ? {claim, requeued: false} : {requeued: false};
  }
  const claim = await claimQueuedInvocation(candidate, params, tx);
  return claim ? {claim, requeued: false} : {requeued: false};
}

async function processExpiredInFlightInvocation(
  candidate: ToolInvocationCandidate,
  params: ClaimToolInvocationsParams,
  tx: Tx,
): Promise<{claim?: ToolInvocationClaim; requeued: boolean}> {
  const canRetry =
    toolStepSensitivity(candidate.step) === 'read' &&
    candidate.invocation.callIndex + 1 < MAX_TOOL_STEP_CALLS_PER_ATTEMPT;
  if (canRetry) {
    const requeued = await requeueExpiredInvocation(candidate, params, tx);
    return {requeued};
  }
  const claim = await claimInterruptedInvocation(candidate, params, tx);
  return claim ? {claim, requeued: false} : {requeued: false};
}

async function claimQueuedInvocation(
  candidate: ToolInvocationCandidate,
  params: ClaimToolInvocationsParams,
  tx: Tx,
): Promise<ToolInvocationClaim | undefined> {
  const [invocation] = await tx
    .update(toolInvocations)
    .set({
      status: 'in_flight',
      claimedBy: params.claimOwner,
      claimExpiresAt: params.claimExpiresAt,
    })
    .where(
      and(eq(toolInvocations.id, candidate.invocation.id), eq(toolInvocations.status, 'queued')),
    )
    .returning();
  if (!invocation) return undefined;

  const stepAttempt = await updateStepAttemptInvocations(tx, candidate.stepAttempt.id, (history) =>
    markInvocationStarted(history, candidate.invocation.callIndex, params.now),
  );
  if (!stepAttempt) {
    // The step or attempt may have become terminal after the candidate query.
    // Do not let a stale claim escape the transaction and call the provider.
    await settleUnusableInvocation(candidate, params, tx);
    return undefined;
  }
  return {
    invocation,
    step: toStep(candidate.step),
    attempt: toStepAttempt(stepAttempt),
    workflowContext: candidate.workflowContext,
    interrupted: false,
  };
}

async function claimInterruptedInvocation(
  candidate: ToolInvocationCandidate,
  params: ClaimToolInvocationsParams,
  tx: Tx,
): Promise<ToolInvocationClaim | undefined> {
  const [invocation] = await tx
    .update(toolInvocations)
    .set({
      status: 'in_flight',
      claimedBy: params.claimOwner,
      claimExpiresAt: params.claimExpiresAt,
      lastErrorCode: INVOCATION_INTERRUPTED_ERROR_CODE,
    })
    .where(eq(toolInvocations.id, candidate.invocation.id))
    .returning();
  if (!invocation) return undefined;

  const stepAttempt = await updateStepAttemptInvocations(tx, candidate.stepAttempt.id, (history) =>
    finishInvocation(
      history,
      candidate.invocation.callIndex,
      params.now,
      INVOCATION_INTERRUPTED_ERROR_CODE,
    ),
  );
  if (!stepAttempt) {
    // An expired claim is unusable once its running attempt has disappeared.
    // Settle the invocation without returning work to the external provider.
    await settleUnusableInvocation(candidate, params, tx);
    return undefined;
  }
  return {
    invocation,
    step: toStep(candidate.step),
    attempt: toStepAttempt(stepAttempt),
    workflowContext: candidate.workflowContext,
    interrupted: true,
  };
}

async function requeueExpiredInvocation(
  candidate: ToolInvocationCandidate,
  params: ClaimToolInvocationsParams,
  tx: Tx,
): Promise<boolean> {
  const nextCallIndex = candidate.invocation.callIndex + 1;
  const [invocation] = await tx
    .update(toolInvocations)
    .set({
      status: 'queued',
      callIndex: nextCallIndex,
      dueAt: params.now,
      claimedBy: null,
      claimExpiresAt: null,
      lastErrorCode: INVOCATION_INTERRUPTED_ERROR_CODE,
    })
    .where(
      and(eq(toolInvocations.id, candidate.invocation.id), eq(toolInvocations.status, 'in_flight')),
    )
    .returning({id: toolInvocations.id});
  if (!invocation) return false;

  const stepAttempt = await updateStepAttemptInvocations(
    tx,
    candidate.stepAttempt.id,
    (history) => {
      const finished = finishInvocation(
        history,
        candidate.invocation.callIndex,
        params.now,
        INVOCATION_INTERRUPTED_ERROR_CODE,
      );
      return queueInvocation(finished, nextCallIndex, params.now);
    },
  );
  if (!stepAttempt) {
    // Keep the invocation and its history in sync when the candidate became
    // unusable between the candidate snapshot and the history update.
    await settleUnusableInvocation(candidate, params, tx);
    return false;
  }
  return true;
}

async function settleUnusableInvocation(
  candidate: ToolInvocationCandidate,
  params: ClaimToolInvocationsParams,
  tx: Tx,
): Promise<void> {
  const errorCode =
    candidate.invocation.status === 'in_flight'
      ? INVOCATION_INTERRUPTED_ERROR_CODE
      : (candidate.invocation.lastErrorCode ?? undefined);
  await tx
    .update(toolInvocations)
    .set({
      status: 'settled',
      claimedBy: null,
      claimExpiresAt: null,
      lastErrorCode: errorCode ?? null,
    })
    .where(eq(toolInvocations.id, candidate.invocation.id));

  await updateStepAttemptInvocations(tx, candidate.stepAttempt.id, (history) =>
    finishInvocation(history, candidate.invocation.callIndex, params.now, errorCode),
  );
}

async function retryToolInvocationInTransaction(
  params: RetryToolInvocationParams,
  tx: Tx,
): Promise<boolean> {
  try {
    return await tx.transaction(async (transitionTx) => {
      const nextCallIndex = params.callIndex + 1;
      const [updated] = await transitionTx
        .update(toolInvocations)
        .set({
          status: 'queued',
          callIndex: nextCallIndex,
          dueAt: params.dueAt,
          claimedBy: null,
          claimExpiresAt: null,
          lastErrorCode: params.errorCode,
        })
        .where(
          and(
            eq(toolInvocations.id, params.invocationId),
            eq(toolInvocations.status, 'in_flight'),
            eq(toolInvocations.claimedBy, params.claimOwner),
          ),
        )
        .returning({id: toolInvocations.id});
      if (!updated) return false;

      const stepAttempt = await updateStepAttemptInvocations(
        transitionTx,
        params.stepAttemptId,
        (history) => {
          const finished = finishInvocation(
            history,
            params.callIndex,
            params.finishedAt,
            params.errorCode,
            params.durationMs,
          );
          return queueInvocation(finished, nextCallIndex, params.dueAt);
        },
      );
      if (!stepAttempt) throw new MissingRunningToolAttemptError(params.stepAttemptId);
      return true;
    });
  } catch (error) {
    if (error instanceof MissingRunningToolAttemptError) return false;
    throw error;
  }
}

async function settleToolInvocationInTransaction(
  params: SettleToolInvocationParams,
  tx: Tx,
): Promise<boolean> {
  try {
    return await tx.transaction(async (transitionTx) => {
      const [updated] = await transitionTx
        .update(toolInvocations)
        .set({
          status: 'settled',
          claimedBy: null,
          claimExpiresAt: null,
          lastErrorCode: params.errorCode ?? null,
        })
        .where(
          and(
            eq(toolInvocations.id, params.invocationId),
            eq(toolInvocations.status, 'in_flight'),
            eq(toolInvocations.claimedBy, params.claimOwner),
          ),
        )
        .returning({id: toolInvocations.id});
      if (!updated) return false;

      const stepAttempt = await updateStepAttemptInvocations(
        transitionTx,
        params.stepAttemptId,
        (history) =>
          finishInvocation(
            history,
            params.callIndex,
            params.finishedAt,
            params.errorCode,
            params.durationMs,
            params.outcome,
          ),
      );
      if (!stepAttempt) throw new MissingRunningToolAttemptError(params.stepAttemptId);
      return true;
    });
  } catch (error) {
    if (error instanceof MissingRunningToolAttemptError) return false;
    throw error;
  }
}

async function updateStepAttemptInvocations(
  tx: Tx,
  stepAttemptId: string,
  update: (history: readonly StepAttemptInvocation[]) => readonly StepAttemptInvocation[],
): Promise<StepAttemptDb | undefined> {
  const [current] = await tx
    .select({stepAttempt: stepAttempts})
    .from(stepAttempts)
    .innerJoin(
      steps,
      and(
        eq(stepAttempts.stepId, steps.id),
        eq(stepAttempts.jobExecutionId, steps.jobExecutionId),
        eq(steps.status, 'running'),
      ),
    )
    .where(and(eq(stepAttempts.id, stepAttemptId), eq(stepAttempts.status, 'running')))
    .limit(1)
    .for('update', {of: [stepAttempts]});
  if (!current) return undefined;

  const [updated] = await tx
    .update(stepAttempts)
    .set({invocations: update(current.stepAttempt.invocations ?? [])})
    .where(and(eq(stepAttempts.id, stepAttemptId), eq(stepAttempts.status, 'running')))
    .returning();
  return updated;
}

class MissingRunningToolAttemptError extends Error {
  constructor(stepAttemptId: string) {
    super(`Tool invocation step attempt is no longer running: ${stepAttemptId}`);
    this.name = 'MissingRunningToolAttemptError';
  }
}

function markInvocationStarted(
  history: readonly StepAttemptInvocation[],
  callIndex: number,
  startedAt: Date,
): readonly StepAttemptInvocation[] {
  const entry = {...invocationEntry(history, callIndex, startedAt)} as Record<string, unknown>;
  delete entry.finished_at;
  delete entry.outcome;
  delete entry.error_code;
  delete entry.duration_ms;
  delete entry.next_due_at;
  return replaceInvocation(history, callIndex, entry as unknown as StepAttemptInvocation);
}

function finishInvocation(
  history: readonly StepAttemptInvocation[],
  callIndex: number,
  finishedAt: Date,
  errorCode: string | undefined,
  durationMs?: number,
  outcome: 'success' | 'error' = 'error',
): readonly StepAttemptInvocation[] {
  const entry = {...invocationEntry(history, callIndex, finishedAt)} as Record<string, unknown>;
  entry.finished_at = finishedAt.toISOString();
  entry.outcome = outcome;
  if (errorCode === undefined) delete entry.error_code;
  else entry.error_code = errorCode;
  if (durationMs === undefined) delete entry.duration_ms;
  else entry.duration_ms = durationMs;
  delete entry.next_due_at;
  return replaceInvocation(history, callIndex, entry as unknown as StepAttemptInvocation);
}

function queueInvocation(
  history: readonly StepAttemptInvocation[],
  callIndex: number,
  dueAt: Date,
): readonly StepAttemptInvocation[] {
  const entry = {...invocationEntry(history, callIndex, dueAt)} as Record<string, unknown>;
  entry.started_at = dueAt.toISOString();
  delete entry.finished_at;
  delete entry.outcome;
  delete entry.error_code;
  delete entry.duration_ms;
  entry.next_due_at = dueAt.toISOString();
  return replaceInvocation(history, callIndex, entry as unknown as StepAttemptInvocation);
}

function invocationEntry(
  history: readonly StepAttemptInvocation[],
  callIndex: number,
  fallbackStartedAt: Date,
): StepAttemptInvocation {
  const existing = history.find((entry) => entry.call_index === callIndex);
  return existing
    ? {...existing}
    : {call_index: callIndex, started_at: fallbackStartedAt.toISOString()};
}

function replaceInvocation(
  history: readonly StepAttemptInvocation[],
  callIndex: number,
  replacement: StepAttemptInvocation,
): readonly StepAttemptInvocation[] {
  const index = history.findIndex((entry) => entry.call_index === callIndex);
  if (index < 0) return [...history, replacement];
  return history.map((entry, entryIndex) => (entryIndex === index ? replacement : entry));
}

function toolStepSensitivity(step: StepDb): 'read' | 'write' {
  const tool = step.config.tool;
  if (tool === null || typeof tool !== 'object' || Array.isArray(tool)) return 'write';
  return (tool as Record<string, unknown>).sensitivity === 'read' ? 'read' : 'write';
}
