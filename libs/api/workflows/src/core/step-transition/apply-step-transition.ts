import type {LogOutcomeDto} from '@shipfox/api-workflows-dto';
import type {Tx} from '#db/db.js';
import {
  applyStepResult,
  finishStepAttempt,
  getStepsByJobExecutionIdForUpdate,
  rewindStepsToPending,
  settleJobFailed,
  writeJobStepsSettledOutbox,
  writeStepRestartEnqueuedOutbox,
} from '#db/workflow-runs.js';
import {
  deriveCompletion,
  isTerminal,
  type StepReport,
  type StepTransitionDecision,
} from './decide-step-transition.js';

export type StepProgressionOutcome =
  | {jobFinished: false}
  | {jobFinished: true; status: 'succeeded' | 'failed'};

export interface StepProgressionMetrics {
  jobStepsSettledStatus?: 'succeeded' | 'failed';
  stepRestartEnqueued?: boolean;
}

export interface StepProgressionResult {
  outcome: StepProgressionOutcome;
  metrics: StepProgressionMetrics;
}

export interface ApplyStepTransitionContext {
  jobId: string;
  jobExecutionId: string;
  result: StepReport;
  logOutcome: LogOutcomeDto;
  // Gate evaluation audit payload to record on the attempt, when a gate ran.
  gateResult?: Record<string, unknown> | null;
}

type SuccessfulStepDecision = Extract<
  StepTransitionDecision,
  {kind: 'complete-step' | 'complete-job'}
>;
type FailedStepDecision = Extract<
  StepTransitionDecision,
  {kind: 'fail-job' | 'fail-job-restart-exhausted'}
>;
type RestartStepDecision = Extract<StepTransitionDecision, {kind: 'restart-job-from-step'}>;

// Durable side of the decision: writes the attempt + projection for a transition,
// then derives job completion from the post-apply projection and enqueues the
// completion event in the same transaction. Only called for a running target, so
// every path here is an actual state change (idempotent no-ops are handled by the
// caller before deciding).
export async function applyStepTransition(
  decision: StepTransitionDecision,
  ctx: ApplyStepTransitionContext,
  tx: Tx,
): Promise<StepProgressionResult> {
  switch (decision.kind) {
    case 'complete-step':
    case 'complete-job': {
      await applySuccessfulStepTransition(decision, ctx, tx);
      break;
    }
    case 'fail-job':
    case 'fail-job-restart-exhausted': {
      return applyFailedStepTransition(decision, ctx, tx);
    }
    case 'restart-job-from-step': {
      return applyRestartStepTransition(decision, ctx, tx);
    }
  }

  return settleCompletedStepTransition(ctx, tx);
}

async function applySuccessfulStepTransition(
  decision: SuccessfulStepDecision,
  ctx: ApplyStepTransitionContext,
  tx: Tx,
): Promise<void> {
  // A passing gate makes a step succeed even if the raw command status was
  // 'failed', so the projection error is cleared regardless of the report.
  await finishStepAttempt(
    {
      stepId: decision.stepId,
      attempt: decision.attempt,
      status: 'succeeded',
      output: ctx.result.output ?? null,
      response: ctx.result.response ?? null,
      exitCode: ctx.result.exitCode ?? null,
      logOutcome: ctx.logOutcome,
      gateResult: ctx.gateResult ?? null,
    },
    tx,
  );
  await applyStepResult(
    {
      jobExecutionId: ctx.jobExecutionId,
      stepId: decision.stepId,
      status: 'succeeded',
      error: null,
    },
    tx,
  );
}

async function applyFailedStepTransition(
  decision: FailedStepDecision,
  ctx: ApplyStepTransitionContext,
  tx: Tx,
): Promise<StepProgressionResult> {
  await finishStepAttempt(
    {
      stepId: decision.failedStepId,
      attempt: decision.attempt,
      status: 'failed',
      output: ctx.result.output ?? null,
      response: ctx.result.response ?? null,
      error: decision.failureError,
      exitCode: ctx.result.exitCode ?? null,
      logOutcome: ctx.logOutcome,
      gateResult: ctx.gateResult ?? null,
    },
    tx,
  );
  const status = await settleJobFailed(tx, {
    jobId: ctx.jobId,
    jobExecutionId: ctx.jobExecutionId,
    failedStepId: decision.failedStepId,
    error: decision.failureError ?? {message: 'Step failed'},
  });
  if (status !== null) {
    return {
      outcome: {jobFinished: true, status},
      metrics: {jobStepsSettledStatus: status},
    };
  }
  return {outcome: {jobFinished: false}, metrics: {}};
}

async function applyRestartStepTransition(
  decision: RestartStepDecision,
  ctx: ApplyStepTransitionContext,
  tx: Tx,
): Promise<StepProgressionResult> {
  // Record the failed attempt FIRST (audit, with the restart feedback), then
  // rewind the projection from restart_from so the prior result is preserved
  // only in the attempt history. All in one transaction with the report.
  await finishStepAttempt(
    {
      stepId: decision.failedStepId,
      attempt: decision.attempt,
      status: 'failed',
      output: ctx.result.output ?? null,
      response: ctx.result.response ?? null,
      error: decision.failureError,
      exitCode: ctx.result.exitCode ?? null,
      logOutcome: ctx.logOutcome,
      gateResult: ctx.gateResult ?? null,
      restartFeedback: decision.feedback,
    },
    tx,
  );
  await rewindStepsToPending(
    {jobExecutionId: ctx.jobExecutionId, fromPosition: decision.restartFromPosition},
    tx,
  );
  await writeStepRestartEnqueuedOutbox(tx, {
    jobId: ctx.jobId,
    failedStepId: decision.failedStepId,
    failedStepAttempt: decision.attempt,
    restartFromStepId: decision.restartFromStepId,
    feedback: decision.feedback,
  });
  // The job stays running; the next pull re-dispatches restart_from. Do not
  // derive completion or emit a completion event.
  return {outcome: {jobFinished: false}, metrics: {stepRestartEnqueued: true}};
}

async function settleCompletedStepTransition(
  ctx: ApplyStepTransitionContext,
  tx: Tx,
): Promise<StepProgressionResult> {
  // Re-derive completion from the post-apply projection and emit the
  // steps-settled signal exactly once, here on the applied path.
  const after = await getStepsByJobExecutionIdForUpdate(ctx.jobExecutionId, tx);
  if (after.every((step) => isTerminal(step.status))) {
    const status = deriveCompletion(after);
    await writeJobStepsSettledOutbox(tx, {
      jobId: ctx.jobId,
      jobExecutionId: ctx.jobExecutionId,
      status,
    });
    return {
      outcome: {jobFinished: true, status},
      metrics: {jobStepsSettledStatus: status},
    };
  }
  return {outcome: {jobFinished: false}, metrics: {}};
}
