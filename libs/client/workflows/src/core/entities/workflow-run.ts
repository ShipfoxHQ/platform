import {
  type JobDisplayStatus,
  type JobMode,
  type JobStatus,
  type ListenerStatus,
  WORKFLOW_JOB_STATUSES,
} from './job.js';
import type {JobExecutionStatus} from './job-execution.js';
import type {WorkflowRunAttemptSummary} from './workflow-run-attempt.js';

export type WorkflowRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type WorkflowRunRerunMode = 'all' | 'failed';
export type WorkflowStatus = WorkflowRunStatus | (typeof WORKFLOW_JOB_STATUSES)[number];

/** Where a run's definition came from: the synced default branch, or a dev run from a ref. */
export const WORKFLOW_RUN_ORIGINS = ['synced', 'dev'] as const;

export type WorkflowRunOrigin = (typeof WORKFLOW_RUN_ORIGINS)[number];

/**
 * Dev-run provenance: the ref and pinned commit the definition came from, the file that
 * ran, the user who started the run, and the journaled event it replays when any.
 */
export interface WorkflowRunDevSource {
  ref: string;
  commit: string;
  configPath: string;
  initiatedByUserId: string;
  replayOfEventId: string | null;
}
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
  origin: WorkflowRunOrigin;
  devSource: WorkflowRunDevSource | null;
  number: number | null;
  name: string;
  workflowName: string;
  currentAttempt: number;
  triggerProvider: string | null;
  triggerSource: string;
  triggerEvent: string;
  triggerDisplayLabel: string;
  triggerLabel: string;
  triggerReference: WorkflowRunTriggerReference | null;
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

export interface WorkflowRunListPage {
  runs: WorkflowRunListItem[];
  nextCursor: string | null;
  filteredTotalCount: number | null;
}

export interface ManualWorkflowLaunch {
  workflowRunId: string;
}

export interface DevRunLaunch {
  workflowRunId: string;
  /** The commit the dev definition was read from, as the server pinned it. */
  commit: string;
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
 *
 * A dev run without a trigger reference (manual or cron dev runs) has nothing to resolve, so
 * the label falls back to the dev source's ref: the branch or tag the definition came from.
 * A dev replay still carries the replayed event's reference and shows that, exactly as the
 * run list promises.
 */
export function workflowRunBranchLabel(
  run: Pick<WorkflowRun, 'triggerReference' | 'devSource'>,
): string | null {
  const ref = workflowRunProvenanceSource(run)?.ref ?? null;
  if (!ref) return null;
  const pullRequest = PULL_REQUEST_REF_PATTERN.exec(ref);
  if (pullRequest) return `#${pullRequest[1]}`;
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
  if (ref.startsWith('refs/tags/')) return ref.slice('refs/tags/'.length);
  return ref;
}

export function workflowRunCommitLabel(
  run: Pick<WorkflowRun, 'triggerReference' | 'devSource'>,
): string | null {
  const commit = workflowRunProvenanceSource(run)?.commit ?? null;
  return commit ? commit.slice(0, SHORT_COMMIT_LENGTH) : null;
}

/**
 * A partial trigger reference cannot identify the executed source on its own. Keep ref and
 * commit paired, falling back to the dev source when either trigger value is missing.
 */
function workflowRunProvenanceSource(run: Pick<WorkflowRun, 'triggerReference' | 'devSource'>) {
  const triggerReference = run.triggerReference;
  if (triggerReference?.ref && triggerReference.commit) return triggerReference;

  const devSource = run.devSource;
  if (devSource?.ref && devSource.commit) return devSource;

  // Preserve partial trigger data for synced runs; there is no dev source to replace it with.
  return triggerReference ?? devSource;
}

export function workflowRunActor(run: Pick<WorkflowRun, 'triggerReference'>): string | null {
  return run.triggerReference?.actor ?? null;
}

/**
 * The dev run's effective provenance as one label: `ref @ commit`. Replayed runs use the
 * trigger reference shown by the list; other dev runs use the dev source. The commit is
 * shortened like the list row's commit label.
 */
export function workflowRunDevSourceLabel(
  run: Pick<WorkflowRun, 'origin' | 'devSource' | 'triggerReference'>,
): string | null {
  if (run.origin !== 'dev' || !run.devSource) return null;
  const ref = workflowRunBranchLabel(run);
  const commit = workflowRunCommitLabel(run);
  if (!ref || !commit) return null;
  return `${ref} @ ${commit}`;
}

/**
 * Who started a dev run, as a person reads it: `You` when the run is the current user's, a
 * short id otherwise (v1 has no member-directory lookup on this surface). Synced runs have
 * no initiator: their actor is the triggering event's, which `workflowRunActor` carries.
 */
export function workflowRunInitiatorLabel(
  run: Pick<WorkflowRun, 'origin' | 'devSource'>,
  currentUserId: string | undefined,
): string | null {
  const initiator = run.origin === 'dev' ? run.devSource?.initiatedByUserId : undefined;
  if (!initiator) return null;
  return initiator === currentUserId ? 'You' : initiator.slice(0, 8);
}

export function isWorkflowRunTerminal(status: WorkflowRunStatus): boolean {
  return TERMINAL_WORKFLOW_RUN_STATUS_SET.has(status);
}

export function isWorkflowStatus(status: string): status is WorkflowStatus {
  return WORKFLOW_STATUSES.has(status as WorkflowStatus);
}
