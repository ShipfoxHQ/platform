import {
  isTerminalJobStatus,
  type JobDisplayStatus,
  type JobMode,
  type JobStatus,
  type JobStatusReason,
  type ListenerStatus,
} from './job.js';
import {
  type JobExecutionDisplayDuration,
  type JobExecutionStatus,
  jobExecutionDisplayDurationFromTimestamps,
} from './job-execution.js';
import type {StepSourceLocation} from './step.js';
import type {WorkflowRunOrigin, WorkflowRunStatus} from './workflow-run.js';
import type {WorkflowRunAttempt} from './workflow-run-attempt.js';

export type BoundedExecutionCount = number | '100+';

export interface WorkflowRunLineageHead {
  currentAttempt: number;
  latestAttempt: number;
  currentStatus: WorkflowRunStatus;
  updatedAt: string;
}

export interface WorkflowRunOverviewHeader {
  id: string;
  projectId: string;
  definitionId: string;
  number: number | null;
  name: string;
  workflowName: string;
  origin: WorkflowRunOrigin;
  devSource: {
    ref: string;
    commit: string;
    configPath: string;
    initiatedByUserId: string;
    replayOfEventId: string | null;
  } | null;
  triggerProvider: string | null;
  triggerSource: string;
  triggerEvent: string;
  triggerDisplayLabel: string;
  triggerLabel: string;
  triggerReference: {
    repository: string | null;
    ref: string | null;
    commit: string | null;
    actor: string | null;
  } | null;
  createdAt: string;
}

export interface WorkflowRunOverviewExecution {
  id: string;
  sequence: number;
  name: string;
  status: JobExecutionStatus;
  displayStatus: JobExecutionStatus;
  statusReason: JobStatusReason | null;
  statusReasonMessage: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  timedOutAt: string | null;
  updatedAt: string;
  displayDuration: JobExecutionDisplayDuration | null;
}

interface WorkflowRunOverviewJobFields {
  id: string;
  key: string;
  name: string | null;
  position: number;
  dependencies: string[];
  status: JobStatus;
  statusReason: JobStatusReason | null;
  mode: JobMode;
  listenerStatus: ListenerStatus;
  carriedOver: boolean;
  executionCount: BoundedExecutionCount;
  executionStatusCounts: Record<JobExecutionStatus, BoundedExecutionCount>;
  defaultExecution: WorkflowRunOverviewExecution | null;
}

/** A graph or rail job without its execution or step tree. */
export class WorkflowRunOverviewJob {
  id!: string;
  key!: string;
  name!: string | null;
  position!: number;
  dependencies!: string[];
  status!: JobStatus;
  statusReason!: JobStatusReason | null;
  mode!: JobMode;
  listenerStatus!: ListenerStatus;
  carriedOver!: boolean;
  executionCount!: BoundedExecutionCount;
  executionStatusCounts!: Record<JobExecutionStatus, BoundedExecutionCount>;
  defaultExecution!: WorkflowRunOverviewExecution | null;

  constructor(fields: WorkflowRunOverviewJobFields) {
    Object.assign(this, fields);
  }

  get displayName(): string {
    return this.name ?? this.key;
  }

  get displayDuration(): JobExecutionDisplayDuration | null {
    if (this.mode === 'listening') return null;
    return this.defaultExecution?.displayDuration ?? null;
  }

  get executionCountVisible(): boolean {
    return this.mode === 'listening' || this.executionCount === '100+' || this.executionCount > 1;
  }

  get displayStatus(): JobDisplayStatus {
    if (isTerminalJobStatus(this.status)) return this.status;
    if (this.mode === 'listening' && this.listenerStatus === 'listening') return 'listening';
    return this.defaultExecution?.displayStatus ?? 'pending';
  }
}

export interface WorkflowRunOverviewJobPage {
  items: WorkflowRunOverviewJob[];
  nextCursor: string | null;
  total?: number | undefined;
}

export interface WorkflowRunOverviewCompleteJobs {
  kind: 'complete';
  total: number;
  items: WorkflowRunOverviewJob[];
}

export interface WorkflowRunOverviewLargeJobs {
  kind: 'large';
  total: number;
  statusCounts: Array<{status: JobStatus; count: number}>;
  firstPage: WorkflowRunOverviewJobPage & {total: number};
}

export type WorkflowRunOverviewJobs =
  | WorkflowRunOverviewCompleteJobs
  | WorkflowRunOverviewLargeJobs;

export interface WorkflowRunOverview extends WorkflowRunOverviewHeader {
  currentAttempt: number;
  latestAttempt: number;
  runAttempt: WorkflowRunAttempt;
  hasStartedJobExecution: boolean;
  jobs: WorkflowRunOverviewJobs;
}

export function toWorkflowRunOverviewExecutionDuration({
  queuedAt,
  startedAt,
  finishedAt,
}: Pick<WorkflowRunOverviewExecution, 'queuedAt' | 'startedAt' | 'finishedAt'>) {
  return jobExecutionDisplayDurationFromTimestamps({queuedAt, startedAt, finishedAt});
}

export interface WorkflowRunSelectionResolution {
  workflowRunId: string;
  workflowRunAttempt: number;
  jobId: string | null;
  jobExecutionId: string | null;
  stepId: string | null;
  stepAttemptId: string | null;
  stepAttempt: number | null;
  sourceLocation: StepSourceLocation | null;
}
