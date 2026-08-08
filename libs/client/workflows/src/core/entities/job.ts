import {
  deriveJobExecutionDisplayStatus,
  type JobExecution,
  type JobExecutionDisplayDuration,
} from './job-execution.js';
import type {EvaluationTraceEntry} from './step-attempt.js';

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';
export type JobDisplayStatus = JobStatus | 'listening';
export type JobMode = 'one_shot' | 'listening';
export type ListenerStatus = 'inactive' | 'listening' | 'resolved';
export type ResolutionReason = 'until' | 'timeout' | 'max_executions' | 'cancelled';
export type JobStatusReason =
  | 'dependency_not_completed'
  | 'condition_false'
  | 'default_gate_rejected'
  | 'condition_rejected'
  | 'condition_errored'
  | 'user_cancelled'
  | 'run_cancelled'
  | 'timed_out'
  | 'runner_lost'
  | 'output_too_large'
  | 'step_failed'
  | 'unknown';
export interface JobListening {
  on: Array<{
    source: string;
    event: string;
    inputs?: Record<string, unknown> | undefined;
    filter?: string | undefined;
  }>;
  until: Array<{
    source: string;
    event: string;
    inputs?: Record<string, unknown> | undefined;
    filter?: string | undefined;
  }> | null;
  timeoutMs: number | null;
  maxExecutions: number | null;
  batch: {
    debounceMs?: number | undefined;
    maxSize?: number | undefined;
    maxWaitMs?: number | undefined;
  } | null;
  onResolve: 'finish' | 'cancel';
  executionTimeoutMs: number | null;
  name: string | null;
}

export type JobDisplayDuration = JobExecutionDisplayDuration;

export const WORKFLOW_JOB_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
] as const satisfies readonly JobStatus[];

export const TERMINAL_WORKFLOW_JOB_STATUSES = [
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
] as const satisfies readonly JobStatus[];

const TERMINAL_JOB_STATUS_SET = new Set<JobStatus>(TERMINAL_WORKFLOW_JOB_STATUSES);

interface JobFields {
  id: string;
  runAttemptId: string;
  key: string;
  name: string | null;
  mode: JobMode;
  status: JobStatus;
  statusReason: JobStatusReason | null;
  carriedOver: boolean;
  outputs: Record<string, unknown> | null;
  success: string | null;
  runner: string[] | null;
  evaluationTrace: EvaluationTraceEntry[] | null;
  listening: JobListening | null;
  listenerStatus: ListenerStatus;
  resolutionReason: ResolutionReason | null;
  dependencies: string[];
  position: number;
  createdAt: string;
  updatedAt: string;
  jobExecutions: JobExecution[];
}

export class Job {
  id!: string;
  runAttemptId!: string;
  key!: string;
  name!: string | null;
  mode!: JobMode;
  status!: JobStatus;
  statusReason!: JobStatusReason | null;
  carriedOver!: boolean;
  outputs!: Record<string, unknown> | null;
  success!: string | null;
  runner!: string[] | null;
  evaluationTrace!: EvaluationTraceEntry[] | null;
  listening!: JobListening | null;
  listenerStatus!: ListenerStatus;
  resolutionReason!: ResolutionReason | null;
  dependencies!: string[];
  position!: number;
  createdAt!: string;
  updatedAt!: string;
  jobExecutions!: JobExecution[];

  constructor(fields: JobFields) {
    Object.assign(this, fields);
  }

  get displayName(): string {
    return this.name ?? this.key;
  }

  get displayDuration(): JobDisplayDuration | null {
    if (this.mode === 'listening') return null;
    if (this.jobExecutions.length !== 1) return null;
    return this.jobExecutions[0]?.displayDuration ?? null;
  }

  get executionCountVisible(): boolean {
    return (
      this.jobExecutions.length > 0 && (this.mode === 'listening' || this.jobExecutions.length > 1)
    );
  }
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUS_SET.has(status);
}

export function deriveJobDisplayStatus(
  job: Pick<Job, 'mode' | 'status' | 'listenerStatus' | 'jobExecutions'>,
): JobDisplayStatus {
  if (isTerminalJobStatus(job.status)) return job.status;
  if (job.mode === 'listening' && job.listenerStatus === 'listening') return 'listening';

  const execution = defaultJobExecution(job);
  return execution ? deriveJobExecutionDisplayStatus(execution) : 'pending';
}

export function resolveJobExecution(
  job: Job,
  jobExecutionId: string | undefined,
): JobExecution | undefined {
  const selectedExecution = jobExecutionId
    ? job.jobExecutions.find((jobExecution) => jobExecution.id === jobExecutionId)
    : undefined;
  if (selectedExecution) return selectedExecution;

  return defaultJobExecution(job);
}

export function defaultJobExecution(job: Pick<Job, 'jobExecutions'>): JobExecution | undefined {
  const runningExecution = job.jobExecutions.find(
    (jobExecution) => jobExecution.status === 'running',
  );
  if (runningExecution) return runningExecution;

  return job.jobExecutions.reduce<JobExecution | undefined>((latest, jobExecution) => {
    if (!latest) return jobExecution;
    return jobExecution.sequence > latest.sequence ? jobExecution : latest;
  }, undefined);
}
