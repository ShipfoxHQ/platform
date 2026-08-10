import {
  type Job,
  type JobDisplayStatus,
  type JobMode,
  type JobStatus,
  type ListenerStatus,
  WORKFLOW_JOB_STATUSES,
} from './job.js';
import type {JobExecutionStatus} from './job-execution.js';
import type {WorkflowRunAttempt, WorkflowRunAttemptSummary} from './workflow-run-attempt.js';

export type WorkflowRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type WorkflowRunRerunMode = 'all' | 'failed';
export type WorkflowStatus = WorkflowRunStatus | (typeof WORKFLOW_JOB_STATUSES)[number];
/**
 * `listening` is display-only: the API never returns it, and it is derived from the listener
 * state a job already carries.
 */
export type WorkflowDisplayStatus = WorkflowStatus | 'listening';

export const WORKFLOW_RUN_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const satisfies readonly WorkflowRunStatus[];

export const WORKFLOW_DISPLAY_STATUSES = [
  ...WORKFLOW_RUN_STATUSES,
  ...WORKFLOW_JOB_STATUSES,
  'listening',
] as const satisfies readonly WorkflowDisplayStatus[];

export const TERMINAL_WORKFLOW_RUN_STATUSES = [
  'succeeded',
  'failed',
  'cancelled',
] as const satisfies readonly WorkflowRunStatus[];

const WORKFLOW_STATUSES = new Set<WorkflowStatus>([
  ...WORKFLOW_RUN_STATUSES,
  ...WORKFLOW_JOB_STATUSES,
]);
const TERMINAL_WORKFLOW_RUN_STATUS_SET = new Set<WorkflowRunStatus>(TERMINAL_WORKFLOW_RUN_STATUSES);

export interface WorkflowSourceSnapshot {
  content: string;
  format: 'yaml';
}

/**
 * Provider-neutral trigger facts. Every field is nullable: only source-control triggers
 * resolve a reference at all, and a payload can name a ref without naming an actor.
 */
export interface WorkflowRunTriggerReference {
  repository: string | null;
  ref: string | null;
  commit: string | null;
  actor: string | null;
}

/** One glyph in a run row's job status strip: enough to draw and label it, nothing more. */
export interface WorkflowRunJobSummary {
  id: string;
  key: string;
  name: string | null;
  status: JobStatus;
  mode: JobMode;
  listenerStatus: ListenerStatus;
  executionStatus: JobExecutionStatus | null;
  position: number;
}

export interface WorkflowRunJobStatusCount {
  status: JobDisplayStatus;
  count: number;
}

/**
 * A run's jobs as the list receives them: a bounded slice to draw, plus totals covering all
 * of them.
 *
 * `preview` is capped by the API, so `preview.length` is not the job count and the strip
 * reads `total` and `statusCounts` for anything it says rather than anything it draws. The API
 * also reports whether any job execution has started because a terminal `cancelled` job can have
 * started work even though its job status does not preserve that distinction.
 */
export interface WorkflowRunJobs {
  preview: WorkflowRunJobSummary[];
  statusCounts: WorkflowRunJobStatusCount[];
  hasStartedJobExecution: boolean;
  total: number;
}

export interface WorkflowRun {
  id: string;
  projectId: string;
  definitionId: string;
  number: number | null;
  name: string;
  workflowName: string;
  currentAttempt: number;
  triggerProvider: string | null;
  triggerSource: string;
  triggerEvent: string;
  triggerDisplayLabel: string;
  triggerLabel: string;
  triggerPayload: Record<string, unknown>;
  triggerReference: WorkflowRunTriggerReference | null;
  inputs: Record<string, unknown> | null;
  sourceSnapshot: WorkflowSourceSnapshot | null;
  createdAt: string;
  updatedAt: string;
  isTemporary: boolean;
}

/** A run as the API returns it outside the list: no job strip, because none was fetched. */
export interface WorkflowRunRecord extends WorkflowRun {
  status: WorkflowRunStatus;
  latestAttempt: number;
  runAttempt: WorkflowRunAttemptSummary;
}

export interface WorkflowRunListItem extends WorkflowRunRecord {
  jobs: WorkflowRunJobs;
}

export interface WorkflowRunDetail extends WorkflowRun {
  latestAttempt: number;
  runAttempt: WorkflowRunAttempt;
  jobs: Job[];
}

export interface WorkflowRunListPage {
  runs: WorkflowRunListItem[];
  nextCursor: string | null;
  filteredTotalCount: number | null;
}

export interface ManualWorkflowLaunch {
  workflowRunId: string;
}

export function workflowRunTriggerLabel({
  triggerSource,
  triggerEvent,
}: {
  triggerSource: string;
  triggerEvent: string;
}): string {
  return [triggerSource, triggerEvent].filter(Boolean).join(' · ');
}

export function workflowRunTriggerDisplayLabel({
  triggerSource,
  triggerEvent,
}: {
  triggerSource: string;
  triggerEvent: string;
}): string {
  return triggerEvent || triggerSource;
}

const SHORT_COMMIT_LENGTH = 7;
const PULL_REQUEST_REF_PATTERN = /^refs\/pull\/(\d+)\/head$/u;

/**
 * The ref as a person names it: `main` for a branch, `#42` for a pull request, the tag for a
 * tag. An unrecognized ref is shown verbatim rather than hidden, since a ref nobody can read
 * is still better evidence than a blank cell.
 */
export function workflowRunBranchLabel(run: Pick<WorkflowRun, 'triggerReference'>): string | null {
  const ref = run.triggerReference?.ref;
  if (!ref) return null;
  const pullRequest = PULL_REQUEST_REF_PATTERN.exec(ref);
  if (pullRequest) return `#${pullRequest[1]}`;
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
  if (ref.startsWith('refs/tags/')) return ref.slice('refs/tags/'.length);
  return ref;
}

export function workflowRunCommitLabel(run: Pick<WorkflowRun, 'triggerReference'>): string | null {
  const commit = run.triggerReference?.commit;
  return commit ? commit.slice(0, SHORT_COMMIT_LENGTH) : null;
}

export function workflowRunActor(run: Pick<WorkflowRun, 'triggerReference'>): string | null {
  return run.triggerReference?.actor ?? null;
}

export function isWorkflowRunTerminal(status: WorkflowRunStatus): boolean {
  return TERMINAL_WORKFLOW_RUN_STATUS_SET.has(status);
}

export function isWorkflowStatus(status: string): status is WorkflowStatus {
  return WORKFLOW_STATUSES.has(status as WorkflowStatus);
}

export function workflowRunHasStartedFromJobs(
  jobs: readonly Pick<Job, 'jobExecutions'>[],
): boolean {
  return jobs.some(({jobExecutions}) => jobExecutions.some(({startedAt}) => startedAt !== null));
}
