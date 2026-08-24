import type {Job} from './job.js';
import type {JobExecution} from './job-execution.js';
import type {Step, StepAttempt} from './step.js';
import type {WorkflowRunAttempt} from './workflow-run-attempt.js';

export type WorkflowRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type WorkflowRunOrigin = 'synced' | 'dev';

/**
 * Why a dev run was created: the ref and pinned commit the definition came from, the
 * file that ran, the user who started it, and the journaled event it replays when any.
 */
export interface WorkflowRunDevSource {
  ref: string;
  commit: string;
  configPath: string;
  initiatedByUserId: string;
  replayOfEventId: string | null;
}

export type WorkflowRunOriginState =
  | {origin: 'synced'; devSource: null}
  | {origin: 'dev'; devSource: WorkflowRunDevSource};

export type TerminalWorkflowRunStatus = Extract<
  WorkflowRunStatus,
  'succeeded' | 'failed' | 'cancelled'
>;

const TERMINAL_WORKFLOW_RUN_STATUSES = new Set<WorkflowRunStatus>([
  'succeeded',
  'failed',
  'cancelled',
]);

export function isWorkflowRunTerminal(
  status: WorkflowRunStatus,
): status is TerminalWorkflowRunStatus {
  return TERMINAL_WORKFLOW_RUN_STATUSES.has(status);
}

export interface WorkflowRunTriggerReference {
  project: {id: string} | null;
  repository: string | null;
  ref: string | null;
  commit: string | null;
  actor: string | null;
}

export interface WorkflowSourceSnapshot {
  content: string;
  format: 'yaml';
}

export type TriggerPayload =
  | {
      source: 'manual';
      provider?: 'manual' | undefined;
      event: 'fire';
      // A dev trigger has no subscription row, so the id is optional here.
      subscriptionId?: string | undefined;
      userId: string;
    }
  | {
      source: 'cron';
      provider?: 'cron' | undefined;
      event: 'tick';
      // A dev trigger has no schedule row, so the id is optional here.
      scheduleId?: string | undefined;
    }
  // Integration sources (github, gitlab, sentry, …) flow through opaquely: the
  // run records what fired it and carries the raw event payload, without the
  // triggers module having to know each source's shape.
  | {
      source: string;
      provider?: string | undefined;
      event: string;
      deliveryId: string;
      data: unknown;
    };

export type WorkflowRun = WorkflowRunOriginState & {
  id: string;
  workspaceId: string;
  projectId: string;
  definitionId: string;
  number: number;
  /** Effective runtime name: the resolved override, or workflowName when absent. */
  name: string;
  /** Static workflow-name snapshot preserved from the definition at creation. */
  workflowName: string;
  /** Nullable resolved override retained for rerun fidelity. */
  nameOverride: string | null;
  status: WorkflowRunStatus;
  currentAttempt: number;
  triggerProvider: string | null;
  triggerSource: string;
  triggerEvent: string;
  triggerPayload: TriggerPayload;
  /** Provider-neutral trigger facts captured at run creation, when available. */
  triggerReference?: WorkflowRunTriggerReference | null | undefined;
  inputs: Record<string, unknown> | null;
  sourceSnapshot: WorkflowSourceSnapshot | null;
  triggerIdempotencyKey: string | null;
  timeoutMs: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

export interface StepDetail extends Step {
  attempts: StepAttempt[];
}

export interface JobExecutionDetail extends JobExecution {
  steps: StepDetail[];
}

export interface WorkflowJobDetail extends Job {
  jobExecutions: JobExecutionDetail[];
}

export type WorkflowRunDetail = WorkflowRun & {
  runAttempt: WorkflowRunAttempt;
  latestAttempt: number;
  jobs: WorkflowJobDetail[];
  /** Whether any job execution of this attempt reached its runner, decided here so the detail
   * and the list cannot answer it differently. */
  hasStartedJobExecution: boolean;
};
