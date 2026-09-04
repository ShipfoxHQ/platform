import {type Duration, intervalToDuration} from 'date-fns';
import type {StepError} from './step.js';
import type {WorkflowDiagnosticUnavailableField} from './workflow-diagnostics.js';

export type StepGateResult =
  | {kind: 'none'}
  | {kind: 'not_evaluated'}
  | {kind: 'passed'; passed: true; source: string; exitCode: number | null}
  | {kind: 'failed'; passed: false; source: string; exitCode: number | null}
  | {kind: 'uncheckable'; passed: false; uncheckable: true; reason: string; exitCode: number | null}
  | {kind: 'evaluation_error'; reason: string; exitCode: number | null}
  | {kind: 'unknown'; data: Record<string, unknown>}
  | null;
export type StepAttemptDisplayDuration =
  | {state: 'fixed'; elapsed: Duration}
  | {state: 'live'; fromIso: string};

export interface EvaluationTraceValueEntry {
  expression: string;
  roots: string[];
  fillTarget: string;
  evaluatedAt: string;
  field: string;
  value?: string;
  truncated?: boolean;
  exprTruncated?: boolean;
  reference?: boolean;
  degraded?: boolean;
  envKey?: string;
}

export interface EvaluationTraceLimitEntry {
  truncated: true;
  dropped: number;
}

export type EvaluationTraceEntry = EvaluationTraceValueEntry | EvaluationTraceLimitEntry;

export interface StepAttemptInvocation {
  callIndex: number;
  startedAt: string;
  finishedAt?: string | undefined;
  outcome?: string | undefined;
  errorCode?: string | undefined;
  durationMs?: number | undefined;
  nextDueAt?: string | undefined;
}

interface StepAttemptFields {
  id: string;
  stepId: string;
  jobExecutionId: string;
  attempt: number;
  executionOrder: number;
  status: string;
  exitCode: number | null;
  output: Record<string, unknown> | null;
  outputs: Record<string, unknown> | null;
  response: string | null;
  error: Record<string, unknown> | null;
  stepError: StepError | null;
  gateResult: StepGateResult;
  restartFeedback: string | null;
  invocations: StepAttemptInvocation[];
  startedAt: string;
  finishedAt: string | null;
}

export class StepAttempt {
  id!: string;
  stepId!: string;
  jobExecutionId!: string;
  attempt!: number;
  executionOrder!: number;
  status!: string;
  exitCode!: number | null;
  output!: Record<string, unknown> | null;
  outputs!: Record<string, unknown> | null;
  response!: string | null;
  error!: Record<string, unknown> | null;
  stepError!: StepError | null;
  gateResult!: StepGateResult;
  restartFeedback!: string | null;
  invocations!: StepAttemptInvocation[];
  startedAt!: string;
  finishedAt!: string | null;

  constructor(fields: StepAttemptFields) {
    Object.assign(this, fields);
  }

  get displayDuration(): StepAttemptDisplayDuration | null {
    return stepAttemptDisplayDurationFromTimestamps(this);
  }
}

export interface StepAttemptSession {
  key: string;
  mode: 'resume' | 'fork';
  segment: number;
}

export interface StepAttemptDetail {
  stepId: string;
  attempt: number;
  session: StepAttemptSession | null;
  authoredConfig: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  toolArguments: unknown | null;
  evaluationTrace: EvaluationTraceEntry[] | null;
  /** Additive diagnostic fields are optional while old and new servers roll out together. */
  output?: Record<string, unknown> | null | undefined;
  outputs?: Record<string, unknown> | null | undefined;
  response?: string | null | undefined;
  error?: Record<string, unknown> | null | undefined;
  gateResult?: StepGateResult | undefined;
  invocations?: StepAttemptInvocation[] | undefined;
  restartFeedback?: string | null | undefined;
  oversizedFields?: WorkflowDiagnosticUnavailableField[] | undefined;
}

export function isTerminalStepAttemptStatus(status: string): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

/** Apply the lazy detail response while preserving omitted compact values and bounded unavailable fields. */
export function presentStepAttemptDiagnostics(
  attempt: StepAttempt,
  detail: StepAttemptDetail,
): StepAttempt {
  const unavailableFields = new Set((detail.oversizedFields ?? []).map(({field}) => field));
  return {
    ...attempt,
    displayDuration: attempt.displayDuration,
    output: presentDiagnosticValue(unavailableFields.has('output'), detail.output, attempt.output),
    outputs: presentDiagnosticValue(
      unavailableFields.has('outputs'),
      outputDiagnosticValue(detail),
      attempt.outputs,
    ),
    response: presentDiagnosticValue(
      unavailableFields.has('response'),
      detail.response,
      attempt.response,
    ),
    error: presentDiagnosticValue(unavailableFields.has('error'), detail.error, attempt.error),
    gateResult: presentDiagnosticValue(
      unavailableFields.has('gate_result'),
      detail.gateResult,
      attempt.gateResult,
    ),
    restartFeedback: presentDiagnosticValue(
      unavailableFields.has('restart_feedback'),
      detail.restartFeedback,
      attempt.restartFeedback,
    ),
    invocations:
      detail.invocations && detail.invocations.length > 0
        ? detail.invocations
        : attempt.invocations,
  };
}

function presentDiagnosticValue<T>(
  unavailable: boolean,
  detailValue: T | null | undefined,
  compactValue: T | null,
): T | null {
  if (unavailable) return null;
  if (detailValue !== undefined) return detailValue;
  return compactValue;
}

function outputDiagnosticValue(
  detail: StepAttemptDetail,
): Record<string, unknown> | null | undefined {
  if (detail.outputs !== undefined) return detail.outputs;
  if (detail.output !== undefined) return detail.output;
  return undefined;
}

export function stepAttemptDisplayDurationFromTimestamps({
  startedAt,
  finishedAt,
}: {
  startedAt: string;
  finishedAt: string | null;
}): StepAttemptDisplayDuration | null {
  if (finishedAt === null) return {state: 'live', fromIso: startedAt};

  const elapsed = durationBetween(startedAt, finishedAt);
  return elapsed === null ? null : {state: 'fixed', elapsed};
}

function durationBetween(from: string, to: string): Duration | null {
  const start = new Date(from);
  const end = new Date(to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;

  return intervalToDuration({
    start,
    end: end < start ? start : end,
  });
}
