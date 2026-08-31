import type {PersistedEvaluationTraceEntry, Step, StepStatus} from '../entities/step.js';

const TERMINAL_STATUSES: ReadonlySet<StepStatus> = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
]);

export function isTerminal(status: StepStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function deriveCompletion(steps: Step[]): 'succeeded' | 'failed' {
  return steps.some((step) => step.status === 'failed') ? 'failed' : 'succeeded';
}

// The report the runner sent for the step being decided.
export interface StepReport {
  status: 'succeeded' | 'failed';
  exitCode?: number | null;
  error?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  response?: string | null;
}

// Precomputed gate evaluation (the CEL engine runs in evaluate-gate.ts, never
// here). `passed`/`failed` are clean evaluations; `uncheckable` means the gate
// could not be evaluated (no exit code, or an evaluation error) and is treated
// as a plain command failure. It is never a restart.
export type GateOutcome =
  | {kind: 'no-gate'}
  | {kind: 'passed'; source: string; trace?: readonly PersistedEvaluationTraceEntry[]}
  | {kind: 'failed'; source: string; trace?: readonly PersistedEvaluationTraceEntry[]}
  | {
      kind: 'uncheckable';
      reason: string;
      source?: string;
      trace?: readonly PersistedEvaluationTraceEntry[];
    };

export interface DecideStepTransitionInput {
  // Full job projection, position-ordered (as returned by getStepsByJobIdForUpdate).
  steps: Step[];
  // The reporting step, already confirmed running at `reportedAttempt`.
  target: Step;
  reportedAttempt: number;
  result: StepReport;
  // Precomputed gate evaluation. Absent ⇒ no gate, so `result.status` is authoritative.
  gateOutcome?: GateOutcome;
  // The gate's on_failure policy, if any. Drives the restart branch.
  gateOnFailure?: {restartFrom: string; feedback?: string};
  restartFeedback?: string;
  // Max total attempts for the gating step before restart is exhausted; defaults
  // to DEFAULT_RESTART_ATTEMPT_CAP.
  maxAttempts?: number;
  // The gating step's own execution count (number of its attempts), used for the
  // cap. Defaults to `reportedAttempt`: correct for a single-gate job, where the
  // two are equal; the service passes the real count so a downstream gate in a
  // multi-gate job isn't penalized for upstream-induced rewinds.
  gatingAttemptCount?: number;
}

// Per-step restart cap: the gating step may run at most this many attempts before
// a further restart is refused. Bounds runaway restart loops.
export const DEFAULT_RESTART_ATTEMPT_CAP = 3;

// The semantic outcome of a step report, independent of persistence.
export type StepTransitionDecision =
  | {kind: 'complete-step'; stepId: string; attempt: number}
  // The step succeeds and is the last to finish; apply re-derives the job's
  // terminal status from the projection (it may be `failed` if a sibling was
  // cancelled), so the status is not carried on the decision.
  | {kind: 'complete-job'; stepId: string; attempt: number}
  | {
      kind: 'fail-job';
      failedStepId: string;
      attempt: number;
      // The error to record on the step/attempt (the reported error, or a
      // structured gate error).
      failureError: Record<string, unknown> | null;
    }
  | {
      kind: 'restart-job-from-step';
      failedStepId: string;
      restartFromStepId: string;
      restartFromPosition: number;
      attempt: number;
      feedback: string;
      // Recorded on the failed attempt before the rewind clears the projection.
      failureError: Record<string, unknown> | null;
    }
  | {
      kind: 'fail-job-restart-exhausted';
      failedStepId: string;
      attempt: number;
      maxAttempts: number;
      failureError: Record<string, unknown> | null;
    };

function succeed(target: Step, attempt: number, steps: Step[]): StepTransitionDecision {
  // Completes the job when every other step is already terminal, otherwise just
  // advances this step.
  const everyOtherTerminal = steps
    .filter((step) => step.id !== target.id)
    .every((step) => isTerminal(step.status));
  return everyOtherTerminal
    ? {kind: 'complete-job', stepId: target.id, attempt}
    : {kind: 'complete-step', stepId: target.id, attempt};
}

function fail(
  target: Step,
  attempt: number,
  failureError: Record<string, unknown> | null,
): StepTransitionDecision {
  return {
    kind: 'fail-job',
    failedStepId: target.id,
    attempt,
    failureError,
  };
}

// Pure: maps a step report (and its precomputed gate outcome) to a transition
// decision. No DB, no expression engine. A passing gate succeeds; a checkable
// failure with a resolvable `restart_from` rewinds (until the per-step attempt cap
// is hit); everything else fails the job. An `uncheckable` failure (no exit code /
// eval error) is always a plain failure, never a restart.
export function decideStepTransition(input: DecideStepTransitionInput): StepTransitionDecision {
  const {steps, target, reportedAttempt, result, gateOnFailure} = input;
  const gate = input.gateOutcome ?? {kind: 'no-gate'};
  const maxAttempts = input.maxAttempts ?? DEFAULT_RESTART_ATTEMPT_CAP;

  // 1. Did the step pass? The gate (when present and checkable) is authoritative
  //    over the raw command status.
  if (stepReportPassed(gate, result)) {
    return succeed(target, reportedAttempt, steps);
  }

  // 2. It failed. Classify the failure error and whether it is restartable.
  //    `uncheckable` (no exit code / eval error) is a plain command failure that
  //    never restarts.
  const uncheckable = gate.kind === 'uncheckable';
  const failureError = stepFailureError(gate, result);

  // 3. Restart when a policy is configured and the failure is checkable.
  if (gateOnFailure?.restartFrom && !uncheckable) {
    return restartStepTransition(input, gateOnFailure, failureError, maxAttempts);
  }

  // 4. No restart → plain fail-and-cancel.
  return fail(target, reportedAttempt, failureError);
}

function stepReportPassed(gate: GateOutcome, result: StepReport): boolean {
  if (gate.kind === 'no-gate') return result.status === 'succeeded';
  return gate.kind === 'passed';
}

function stepFailureError(gate: GateOutcome, result: StepReport): Record<string, unknown> | null {
  if (gate.kind === 'failed') {
    return {kind: 'gate_failed', message: 'gate condition not met', source: gate.source};
  }
  if (gate.kind === 'uncheckable') {
    return result.error ?? {kind: 'gate_uncheckable', message: gate.reason};
  }
  return result.error ?? null;
}

function restartStepTransition(
  input: DecideStepTransitionInput,
  gateOnFailure: NonNullable<DecideStepTransitionInput['gateOnFailure']>,
  failureError: Record<string, unknown> | null,
  maxAttempts: number,
): StepTransitionDecision {
  const {steps, target, reportedAttempt} = input;
  const restartStep = steps.find(
    (step) =>
      step.type !== 'setup' &&
      step.position < target.position &&
      step.key === gateOnFailure.restartFrom,
  );
  if (!restartStep) {
    return fail(target, reportedAttempt, {
      kind: 'restart_unresolved',
      message: `could not resolve restart_from "${gateOnFailure.restartFrom}"`,
      restart_from: gateOnFailure.restartFrom,
    });
  }
  const gatingAttemptCount = input.gatingAttemptCount ?? reportedAttempt;
  if (gatingAttemptCount >= maxAttempts) {
    return {
      kind: 'fail-job-restart-exhausted',
      failedStepId: target.id,
      attempt: reportedAttempt,
      maxAttempts,
      failureError: {
        kind: 'restart_exhausted',
        maxAttempts,
        restart_from: gateOnFailure.restartFrom,
      },
    };
  }
  return {
    kind: 'restart-job-from-step',
    failedStepId: target.id,
    restartFromStepId: restartStep.id,
    restartFromPosition: restartStep.position,
    attempt: reportedAttempt,
    feedback: input.restartFeedback ?? gateOnFailure.feedback ?? 'gate condition not met',
    failureError,
  };
}
