import type {WorkflowRunSelectionInput} from '#core/workflow-run-url-state.js';

/**
 * Statuses the run list can filter by. Absent means all; there is deliberately no `all`
 * value, so "no filter" and "every filter" are the same URL rather than two.
 */
export const WORKFLOW_RUN_LIST_STATUSES = ['succeeded', 'failed', 'running', 'cancelled'] as const;

export type WorkflowRunListStatus = (typeof WORKFLOW_RUN_LIST_STATUSES)[number];

export const WORKFLOW_RUN_TABS = ['summary', 'jobs', 'annotations', 'source'] as const;

export type WorkflowRunTab = (typeof WORKFLOW_RUN_TABS)[number];

export const WORKFLOW_RUN_ANNOTATION_SEVERITIES = ['error', 'warning', 'info', 'success'] as const;

export type WorkflowRunAnnotationSeverity = (typeof WORKFLOW_RUN_ANNOTATION_SEVERITIES)[number];

export interface WorkflowRunsSearch extends WorkflowRunSelectionInput {
  search?: string;
  status?: WorkflowRunListStatus[];
  branch?: string[];
  actor?: string[];
  event?: string[];
  /** Inclusive lower bound on the run's local calendar date, `YYYY-MM-DD`. */
  after?: string;
  /** Inclusive upper bound on the run's local calendar date, `YYYY-MM-DD`. */
  before?: string;
  tab?: WorkflowRunTab;
  annotation?: string;
  severity?: WorkflowRunAnnotationSeverity;
}

export type WorkflowJobSearch = Omit<WorkflowRunSelectionInput, 'jobId'>;

const STATUS_VALUES = new Set<string>(WORKFLOW_RUN_LIST_STATUSES);
const TAB_VALUES = new Set<string>(WORKFLOW_RUN_TABS);
const ANNOTATION_SEVERITY_VALUES = new Set<string>(WORKFLOW_RUN_ANNOTATION_SEVERITIES);
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Reads the run list and run detail query string.
 *
 * Every value is dropped rather than rejected when it does not fit: a truncated or
 * hand-edited URL should degrade to a sensible page, never to an error screen. Unknown
 * parameters are ignored for the same reason.
 */
export function validateWorkflowRunsSearch(input: Record<string, unknown>): WorkflowRunsSearch {
  const search = string(input.search);
  const status = repeatable(input.status).filter(isWorkflowRunListStatus);
  const branch = repeatable(input.branch);
  const actor = repeatable(input.actor);
  const event = repeatable(input.event);
  const after = calendarDate(input.after);
  const before = calendarDate(input.before);
  const runAttempt = positiveInteger(input.runAttempt);
  const tabValue = string(input.tab);
  const tab = tabValue && TAB_VALUES.has(tabValue) ? (tabValue as WorkflowRunTab) : undefined;
  const annotation = string(input.annotation);
  const severityValue = string(input.severity);
  const severity =
    severityValue && ANNOTATION_SEVERITY_VALUES.has(severityValue)
      ? (severityValue as WorkflowRunAnnotationSeverity)
      : undefined;

  return {
    ...(search ? {search} : {}),
    ...(status.length > 0 ? {status} : {}),
    ...(branch.length > 0 ? {branch} : {}),
    ...(actor.length > 0 ? {actor} : {}),
    ...(event.length > 0 ? {event} : {}),
    ...(after ? {after} : {}),
    ...(before ? {before} : {}),
    ...(tab ? {tab} : {}),
    ...(annotation ? {annotation} : {}),
    ...(severity ? {severity} : {}),
    ...(string(input.job) ? {jobId: string(input.job)} : {}),
    ...(string(input.jobExecution) ? {jobExecutionId: string(input.jobExecution)} : {}),
    ...(string(input.step) ? {stepId: string(input.step)} : {}),
    ...(string(input.stepAttempt) ? {stepAttemptId: string(input.stepAttempt)} : {}),
    ...(runAttempt ? {runAttempt} : {}),
  };
}

/** Reads the job-detail query string without allowing a job id to leak back into URL state. */
export function validateWorkflowJobSearch(input: Record<string, unknown>): WorkflowJobSearch {
  return workflowJobSelectionSearch(input);
}

/**
 * Writes the query string back.
 *
 * Array values reach the router as arrays and the app's `stringifySearch` expands each into
 * repeated keys; joining them here would defeat that and break on branch names with commas.
 */
export function workflowRunSearchParams(
  search: WorkflowRunsSearch,
  selection: WorkflowRunSelectionInput = search,
) {
  return {
    ...(search.search ? {search: search.search} : {}),
    ...(search.status?.length ? {status: search.status} : {}),
    ...(search.branch?.length ? {branch: search.branch} : {}),
    ...(search.actor?.length ? {actor: search.actor} : {}),
    ...(search.event?.length ? {event: search.event} : {}),
    ...(search.after ? {after: search.after} : {}),
    ...(search.before ? {before: search.before} : {}),
    ...(search.tab && search.tab !== 'summary' ? {tab: search.tab} : {}),
    ...(search.annotation ? {annotation: search.annotation} : {}),
    ...(search.severity ? {severity: search.severity} : {}),
    ...(selection.jobId ? {job: selection.jobId} : {}),
    ...(selection.jobExecutionId ? {jobExecution: selection.jobExecutionId} : {}),
    ...(selection.stepId ? {step: selection.stepId} : {}),
    ...(selection.stepAttemptId ? {stepAttempt: selection.stepAttemptId} : {}),
    ...(selection.runAttempt ? {runAttempt: String(selection.runAttempt)} : {}),
  };
}

export function workflowJobSearchParams(selection: WorkflowJobSearch) {
  return {
    ...(selection.jobExecutionId ? {jobExecution: selection.jobExecutionId} : {}),
    ...(selection.stepId ? {step: selection.stepId} : {}),
    ...(selection.stepAttemptId ? {stepAttempt: selection.stepAttemptId} : {}),
    ...(selection.runAttempt ? {runAttempt: String(selection.runAttempt)} : {}),
  };
}

/** Resolves the run-level surface. Removed Jobs-tab and selection-only URLs fall back to Summary. */
export function workflowRunTab(
  search: Pick<WorkflowRunsSearch, 'tab' | 'jobId' | 'jobExecutionId' | 'stepId' | 'stepAttemptId'>,
): WorkflowRunTab {
  if (search.tab === 'annotations' || search.tab === 'source') return search.tab;
  return 'summary';
}

/** Serializes only list filters when leaving a run detail page for the run list. */
export function workflowRunListSearchParams(search: WorkflowRunsSearch) {
  const {tab: _tab, annotation: _annotation, severity: _severity, ...listSearch} = search;
  return workflowRunSearchParams(listSearch, {});
}

/**
 * A filter change. Each member is explicitly optional-or-undefined so that "present and
 * undefined" (clear this filter) stays distinguishable from "absent" (leave it alone) under
 * `exactOptionalPropertyTypes`.
 */
export interface WorkflowRunFilterPatch {
  search?: string | undefined;
  status?: WorkflowRunListStatus[] | undefined;
  branch?: string[] | undefined;
  actor?: string[] | undefined;
  event?: string[] | undefined;
  after?: string | undefined;
  before?: string | undefined;
}

/**
 * Applies a filter change.
 *
 * A key present with `undefined`, an empty string, or an empty array clears that filter; a
 * key left out is untouched. Cleared filters are deleted rather than stored empty, so "no
 * filter" is one URL instead of several that render the same list.
 */
export function applyWorkflowRunFilterPatch(
  search: WorkflowRunsSearch,
  patch: WorkflowRunFilterPatch,
): WorkflowRunsSearch {
  const next: WorkflowRunsSearch = {...search};
  if ('search' in patch) setOrDelete(next, 'search', patch.search || undefined);
  if ('status' in patch) setOrDelete(next, 'status', nonEmptyList(patch.status));
  if ('branch' in patch) setOrDelete(next, 'branch', nonEmptyList(patch.branch));
  if ('actor' in patch) setOrDelete(next, 'actor', nonEmptyList(patch.actor));
  if ('event' in patch) setOrDelete(next, 'event', nonEmptyList(patch.event));
  if ('after' in patch) setOrDelete(next, 'after', patch.after || undefined);
  if ('before' in patch) setOrDelete(next, 'before', patch.before || undefined);
  return next;
}

/** Drops every filter while keeping the run-selection parameters the detail route owns. */
export function clearWorkflowRunFilters(search: WorkflowRunsSearch): WorkflowRunsSearch {
  return applyWorkflowRunFilterPatch(search, {
    search: undefined,
    status: undefined,
    branch: undefined,
    actor: undefined,
    event: undefined,
    after: undefined,
    before: undefined,
  });
}

/** True when any list filter is active, which separates "no matches" from "no runs". */
export function hasWorkflowRunFilters(search: WorkflowRunsSearch): boolean {
  return Boolean(
    search.search ||
      search.status?.length ||
      search.branch?.length ||
      search.actor?.length ||
      search.event?.length ||
      search.after ||
      search.before,
  );
}

export function workflowRouteParams(input: Record<string, unknown>): {
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId?: string;
} {
  const workspaceSlug = string(input.workspaceSlug);
  const projectSlug = string(input.projectSlug);
  if (!workspaceSlug || !projectSlug)
    throw new Error('Workflow route is missing required path parameters.');
  const workflowRunId = string(input.workflowRunId);
  return workflowRunId ? {workspaceSlug, projectSlug, workflowRunId} : {workspaceSlug, projectSlug};
}

export function workflowJobRouteParams(input: Record<string, unknown>): {
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId: string;
  jobId: string;
} {
  const workspaceSlug = string(input.workspaceSlug);
  const projectSlug = string(input.projectSlug);
  const workflowRunId = string(input.workflowRunId);
  const jobId = string(input.jobId);
  if (!workspaceSlug || !projectSlug || !workflowRunId || !jobId) {
    throw new Error('Workflow job route is missing required path parameters.');
  }
  return {workspaceSlug, projectSlug, workflowRunId, jobId};
}

function workflowJobSelectionSearch(input: Record<string, unknown>): WorkflowJobSearch {
  const jobExecutionId = string(input.jobExecution);
  const stepId = string(input.step);
  const stepAttemptId = string(input.stepAttempt);
  const runAttempt = positiveInteger(input.runAttempt);

  return {
    ...(jobExecutionId ? {jobExecutionId} : {}),
    ...(stepId ? {stepId} : {}),
    ...(stepAttemptId ? {stepAttemptId} : {}),
    ...(runAttempt ? {runAttempt} : {}),
  };
}

function setOrDelete<TKey extends keyof WorkflowRunsSearch>(
  target: WorkflowRunsSearch,
  key: TKey,
  value: WorkflowRunsSearch[TKey] | undefined,
): void {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

function nonEmptyList<TValue>(value: readonly TValue[] | undefined): TValue[] | undefined {
  return value && value.length > 0 ? [...value] : undefined;
}

function isWorkflowRunListStatus(value: string): value is WorkflowRunListStatus {
  return STATUS_VALUES.has(value);
}

/**
 * Normalizes a repeatable parameter into a deduplicated list.
 *
 * A single occurrence parses as a scalar rather than a one-element array, and the parser
 * coerces bare digits to numbers, so `?branch=2024` has to survive as the string `"2024"`.
 */
function repeatable(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const normalized = values.flatMap((entry) => {
    if (typeof entry === 'string') return entry.length > 0 ? [entry] : [];
    if (typeof entry === 'number' && Number.isFinite(entry)) return [String(entry)];
    if (typeof entry === 'boolean') return [String(entry)];
    return [];
  });
  return [...new Set(normalized)];
}

function calendarDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !CALENDAR_DATE_PATTERN.test(value)) return undefined;
  // Rejects a well-shaped but impossible date such as 2026-02-31, which Date rolls forward.
  // Parsed as UTC: whether `2026-05-01` is a real date does not depend on the reader's zone,
  // and a local-time parse would reject a day the reader's zone skipped outright.
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const parsed = new Date(`${value}T00:00:00.000Z`);
  const isRealDate =
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
  return isRealDate ? value : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : undefined;
}
