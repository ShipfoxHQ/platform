import type {PersistedEvaluationTraceEntry} from './step.js';

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';

export type JobMode = 'one_shot' | 'listening';

export type ListenerStatus = 'inactive' | 'listening' | 'resolved';

export type ResolutionReason = 'until' | 'timeout' | 'max_executions' | 'cancelled';

export interface JobCheckout {
  permissions: {
    contents: 'read' | 'write';
  };
  persistCredentials: boolean;
}

export const JOB_STATUS_REASONS = [
  'dependency_not_completed',
  'condition_false',
  'default_gate_rejected',
  'condition_rejected',
  'condition_errored',
  'user_cancelled',
  'run_cancelled',
  'timed_out',
  'runner_lost',
  'output_too_large',
  'step_failed',
  'unknown',
] as const;

export type JobStatusReason = (typeof JOB_STATUS_REASONS)[number];

const JOB_STATUS_REASON_SET = new Set<JobStatusReason>(JOB_STATUS_REASONS);

export interface Job {
  id: string;
  workflowRunAttemptId: string;
  key: string;
  mode: JobMode;
  name: string | null;
  status: JobStatus;
  statusReason: JobStatusReason | null;
  carriedOver: boolean;
  checkout: JobCheckout;
  success?: string | null;
  evaluationTrace?: readonly PersistedEvaluationTraceEntry[] | null;
  executionTimeoutMs?: number | null;
  listeningTimeoutMs: number | null;
  maxExecutions: number | null;
  onResolve: 'finish' | 'cancel' | null;
  batchDebounceMs: number | null;
  batchMaxSize: number | null;
  batchMaxWaitMs: number | null;
  listenerStatus: ListenerStatus;
  resolutionReason: ResolutionReason | null;
  listeningOn: JobListeningTrigger[] | null;
  listeningUntil: JobListeningTrigger[] | null;
  outputs: Record<string, unknown> | null;
  dependencies: string[];
  runner: string[] | null;
  position: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobListeningTrigger {
  readonly source: string;
  readonly event: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly filter?: string;
}

export type TerminalJobStatus = Extract<
  JobStatus,
  'succeeded' | 'failed' | 'cancelled' | 'skipped'
>;

const TERMINAL_JOB_STATUSES = new Set<JobStatus>(['succeeded', 'failed', 'cancelled', 'skipped']);

export function isJobTerminal(status: JobStatus): status is TerminalJobStatus {
  return TERMINAL_JOB_STATUSES.has(status);
}

export function toJobStatusReason(value: string | null): JobStatusReason | null {
  if (value === null) return null;
  return JOB_STATUS_REASON_SET.has(value as JobStatusReason)
    ? (value as JobStatusReason)
    : 'unknown';
}
