import {type Duration, intervalToDuration} from 'date-fns';
import type {Step} from './step.js';
import type {EvaluationTraceEntry} from './step-attempt.js';

export type JobExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type JobExecutionDisplayStatus = JobExecutionStatus;
export interface WorkflowExecutionEvent {
  source: string;
  event: string;
  deliveryId: string;
  receivedAt: string;
  project: {id: string} | null;
  repository: string | null;
  ref: string | null;
  commit: string | null;
  data: unknown;
}
export type JobExecutionTime =
  | {state: 'fixed'; elapsed: Duration}
  | {state: 'live'; fromIso: string};
export type JobExecutionDisplayDuration =
  | ({kind: 'queue'} & JobExecutionTime)
  | ({kind: 'run'} & JobExecutionTime);

interface JobExecutionFields {
  id: string;
  jobId: string;
  sequence: number;
  name: string;
  status: JobExecutionStatus;
  statusReason: string | null;
  statusReasonMessage: string | null;
  runner: string[] | null;
  outputs: Record<string, unknown> | null;
  triggerEvents: WorkflowExecutionEvent[];
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  timedOutAt: string | null;
  evaluationTrace: EvaluationTraceEntry[] | null;
  createdAt: string;
  updatedAt: string;
  steps: Step[];
}

export class JobExecution {
  id!: string;
  jobId!: string;
  sequence!: number;
  name!: string;
  status!: JobExecutionStatus;
  statusReason!: string | null;
  statusReasonMessage!: string | null;
  runner!: string[] | null;
  outputs!: Record<string, unknown> | null;
  triggerEvents!: WorkflowExecutionEvent[];
  queuedAt!: string | null;
  startedAt!: string | null;
  finishedAt!: string | null;
  timedOutAt!: string | null;
  evaluationTrace!: EvaluationTraceEntry[] | null;
  createdAt!: string;
  updatedAt!: string;
  steps!: Step[];

  constructor(fields: JobExecutionFields) {
    Object.assign(this, fields);
  }

  get displayName(): string {
    return this.name;
  }

  get queueTime(): JobExecutionTime | null {
    return jobExecutionQueueTimeFromTimestamps(this);
  }

  get runTime(): JobExecutionTime | null {
    return jobExecutionRunTimeFromTimestamps(this);
  }

  get displayDuration(): JobExecutionDisplayDuration | null {
    return jobExecutionDisplayDurationFromTimestamps(this);
  }
}

export function deriveJobExecutionDisplayStatus({
  status,
  steps,
}: Pick<JobExecution, 'status' | 'steps'>): JobExecutionDisplayStatus {
  if (isTerminalJobExecutionStatus(status)) return status;
  if (steps.some((step) => step.status === 'running')) return 'running';
  return 'pending';
}

export function isTerminalJobExecutionStatus(status: JobExecutionStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

export function jobExecutionQueueTimeFromTimestamps({
  queuedAt,
  startedAt,
  finishedAt,
}: {
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}): JobExecutionTime | null {
  if (queuedAt === null) return null;
  if (finishedAt !== null && startedAt === null) return null;
  if (startedAt === null) return {state: 'live', fromIso: queuedAt};

  const elapsed = durationBetween(queuedAt, startedAt);
  return elapsed === null ? null : {state: 'fixed', elapsed};
}

export function jobExecutionRunTimeFromTimestamps({
  startedAt,
  finishedAt,
}: {
  startedAt: string | null;
  finishedAt: string | null;
}): JobExecutionTime | null {
  if (startedAt === null) return null;
  return elapsedTimeFromTimestamps({from: startedAt, to: finishedAt});
}

/**
 * The elapsed span between two marks, still accruing while the closing mark is missing. Every
 * duration this app shows is one of these, so queue time and run time measure the same way and
 * only differ in which marks they read.
 */
export function elapsedTimeFromTimestamps({
  from,
  to,
}: {
  from: string;
  to: string | null;
}): JobExecutionTime | null {
  if (to === null) return {state: 'live', fromIso: from};

  const elapsed = durationBetween(from, to);
  return elapsed === null ? null : {state: 'fixed', elapsed};
}

export function jobExecutionDisplayDurationFromTimestamps(timestamps: {
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}): JobExecutionDisplayDuration | null {
  const runTime = jobExecutionRunTimeFromTimestamps(timestamps);
  if (runTime !== null) return {kind: 'run', ...runTime};

  const queueTime = jobExecutionQueueTimeFromTimestamps(timestamps);
  if (queueTime !== null) return {kind: 'queue', ...queueTime};

  return null;
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
