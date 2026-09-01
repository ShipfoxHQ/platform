import {type Duration, intervalToDuration} from 'date-fns';

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
  evaluationTrace: EvaluationTraceEntry[] | null;
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
