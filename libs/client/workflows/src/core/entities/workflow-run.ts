import {
  type Job,
  type JobDisplayStatus,
  type JobMode,
  type JobStatus,
  type ListenerStatus,
  WORKFLOW_JOB_STATUSES,
} from './job.js';
import {
  elapsedTimeFromTimestamps,
  type JobExecutionDisplayDuration,
  type JobExecutionStatus,
} from './job-execution.js';
import type {WorkflowRunAttempt, WorkflowRunAttemptSummary} from './workflow-run-attempt.js';

export type WorkflowRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type WorkflowRunRerunMode = 'all' | 'failed';
export type WorkflowStatus = WorkflowRunStatus | (typeof WORKFLOW_JOB_STATUSES)[number];
/**
 * `listening` and `queued` are display-only: the API never returns them, and both are derived
 * from the jobs a run already carries.
 */
export type WorkflowDisplayStatus = WorkflowStatus | 'listening' | 'queued';

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
  'queued',
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
 * reads `total` and `statusCounts` for anything it says rather than anything it draws.
 */
export interface WorkflowRunJobs {
  preview: WorkflowRunJobSummary[];
  statusCounts: WorkflowRunJobStatusCount[];
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

/**
 * A run's headline duration, split the way a job's already is. An attempt's `startedAt` marks
 * when the orchestrator picked the run up, not when work began, so a run whose jobs are all
 * still waiting for a runner reads as queue time rather than as run time.
 */
export type WorkflowRunDisplayDuration = JobExecutionDisplayDuration;

/** What every surface shows for a run, derived together so status and duration cannot disagree. */
export interface WorkflowRunDisplay {
  status: WorkflowDisplayStatus;
  duration: WorkflowRunDisplayDuration | null;
}

/**
 * The evidence a surface can offer about a run's progress.
 *
 * `jobStatuses` is what every surface has: the list carries status counts, the detail carries
 * whole jobs. `firstStartedAt` is the detail's extra precision, and where it is absent the
 * attempt's own mark stands in.
 */
export interface WorkflowRunProgress {
  runStatus: WorkflowRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  jobStatuses: JobDisplayStatus[];
  firstStartedAt?: string | null | undefined;
}

/** When the run's earliest execution began, or null while none of them has. */
export function workflowRunFirstStartedAt(jobs: Job[]): string | null {
  let earliest: string | null = null;
  let earliestMs = Number.POSITIVE_INFINITY;

  for (const job of jobs) {
    for (const {startedAt} of job.jobExecutions) {
      if (startedAt === null) continue;
      const startedMs = new Date(startedAt).getTime();
      if (!Number.isFinite(startedMs) || startedMs >= earliestMs) continue;
      earliest = startedAt;
      earliestMs = startedMs;
    }
  }

  return earliest;
}

/**
 * Whether any work has begun. A run with no jobs on hand is a run whose jobs were not fetched,
 * which is no evidence that nothing started, so it counts as started rather than claiming a
 * queue this surface cannot see.
 */
function workflowRunHasStarted({jobStatuses, firstStartedAt}: WorkflowRunProgress): boolean {
  if (firstStartedAt != null) return true;
  if (jobStatuses.length === 0) return true;
  return jobStatuses.some((status) => status !== 'pending' && status !== 'skipped');
}

/**
 * The single rule behind every run readout. An attempt's `startedAt` marks when the
 * orchestrator picked the run up, not when work began, so a run whose jobs are all still
 * waiting reads as `Queued` for queue time. Calling that "running for 2h" sends an operator to
 * debug a build that never began.
 */
export function deriveWorkflowRunDisplay(progress: WorkflowRunProgress): WorkflowRunDisplay {
  const {runStatus, startedAt, finishedAt, firstStartedAt} = progress;
  const hasStarted = workflowRunHasStarted(progress);
  const status = runStatus === 'running' && !hasStarted ? 'queued' : runStatus;

  if (startedAt === null) return {status, duration: null};

  // A run cancelled before anything started keeps its queue reading rather than reporting a
  // run that never was.
  const time = elapsedTimeFromTimestamps({from: firstStartedAt ?? startedAt, to: finishedAt});
  if (time === null) return {status, duration: null};

  return {status, duration: {kind: hasStarted ? 'run' : 'queue', ...time}};
}

/** The run detail's reading: whole jobs, so queue and run time split on the first execution. */
export function workflowRunDetailDisplay(run: {
  runAttempt: Pick<WorkflowRunAttemptSummary, 'status' | 'startedAt' | 'finishedAt'>;
  jobs: Job[];
}): WorkflowRunDisplay {
  return deriveWorkflowRunDisplay({
    runStatus: run.runAttempt.status,
    startedAt: run.runAttempt.startedAt,
    finishedAt: run.runAttempt.finishedAt,
    jobStatuses: run.jobs.map((job) => job.status),
    firstStartedAt: workflowRunFirstStartedAt(run.jobs),
  });
}

/**
 * The run list's reading: status counts cover every job, not just the drawn preview, so a row
 * reaches the same verdict as the detail page without fetching a single timestamp more.
 */
export function workflowRunListItemDisplay(run: WorkflowRunListItem): WorkflowRunDisplay {
  return deriveWorkflowRunDisplay({
    runStatus: run.status,
    startedAt: run.runAttempt.startedAt,
    finishedAt: run.runAttempt.finishedAt,
    jobStatuses: run.jobs.statusCounts.filter(({count}) => count > 0).map(({status}) => status),
  });
}

/**
 * The job the run is waiting on: the one queued longest without starting. Named only so a
 * queued run says what it waits for instead of showing a number with no subject.
 */
export function workflowRunBlockingJob(jobs: Job[]): Job | null {
  let blocking: Job | null = null;
  let queuedMs = Number.POSITIVE_INFINITY;

  for (const job of jobs) {
    for (const {queuedAt, startedAt, finishedAt} of job.jobExecutions) {
      if (queuedAt === null || startedAt !== null || finishedAt !== null) continue;
      const candidateMs = new Date(queuedAt).getTime();
      if (!Number.isFinite(candidateMs) || candidateMs >= queuedMs) continue;
      blocking = job;
      queuedMs = candidateMs;
    }
  }

  return blocking;
}
