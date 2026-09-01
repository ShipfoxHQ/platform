import {
  type WorkflowRunListItem,
  type WorkflowRunStatus,
  workflowRunActor,
  workflowRunBranchLabel,
  workflowRunCommitLabel,
} from '#core/workflow-run.js';
import type {WorkflowRunListStatus, WorkflowRunsSearch} from '#routes/inputs.js';

export type WorkflowRunFilterCriteria = Pick<
  WorkflowRunsSearch,
  'search' | 'workflow' | 'status' | 'origin' | 'branch' | 'actor' | 'event' | 'after' | 'before'
>;

/** The dimensions whose options are read off the loaded runs rather than a fixed enum. */
export type WorkflowRunFacetName = 'branch' | 'actor' | 'event';

export interface WorkflowRunWorkflowFacet {
  value: string;
  label: string;
}

export type WorkflowRunFacets = Record<WorkflowRunFacetName, string[]> & {
  workflow: WorkflowRunWorkflowFacet[];
};

export function runMatchesSearch(run: WorkflowRunListItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  const haystack = [
    run.id,
    run.name,
    run.workflowName,
    run.status,
    run.triggerLabel,
    run.number?.toString(),
    workflowRunBranchLabel(run),
    workflowRunCommitLabel(run),
    run.devSource?.ref,
    run.devSource?.commit,
    workflowRunActor(run),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

const IN_PROGRESS_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set(['pending', 'running']);

export function runMatchesStatusFilter(
  status: WorkflowRunStatus,
  selected: readonly WorkflowRunListStatus[] | undefined,
): boolean {
  if (!selected || selected.length === 0) return true;
  return selected.some((filter) => {
    // "Running" reads as in-progress: it covers freshly-queued `pending` runs (including the
    // optimistic manual run inserted on fire) so they are not hidden the moment it is on.
    if (filter === 'running') return IN_PROGRESS_STATUSES.has(status);
    return status === filter;
  });
}

/**
 * Applies every active filter to one run.
 *
 * Filtering runs over the pages already fetched, which is what the rail did before this page
 * existed. Making the API honor the same parameters across full history is ENG-512's job; the
 * predicates here are written against the same dimension names so that swap stays local.
 */
export function runMatchesFilters(
  run: WorkflowRunListItem,
  criteria: WorkflowRunFilterCriteria,
): boolean {
  if (!runMatchesStatusFilter(run.status, criteria.status)) return false;
  // Workflow and origin are also sent to the API. These predicates keep the standalone view
  // honest and prevent placeholder data from briefly showing stale rows between queries.
  if (criteria.workflow && run.definitionId !== criteria.workflow) return false;
  if (criteria.origin && run.origin !== criteria.origin) return false;
  if (!matchesFacet(criteria.branch, workflowRunBranchLabel(run))) return false;
  if (!matchesFacet(criteria.actor, workflowRunActor(run))) return false;
  if (!matchesFacet(criteria.event, run.triggerEvent)) return false;
  if (!matchesDateBounds(run, criteria)) return false;
  return runMatchesSearch(run, criteria.search ?? '');
}

/**
 * Filter options read off the loaded runs.
 *
 * Values the user already selected are folded in even when no loaded run carries them, so a
 * shared link never renders as though its own filter were unset.
 */
export function workflowRunFacets(
  runs: readonly WorkflowRunListItem[],
  criteria: WorkflowRunFilterCriteria = {},
  workflows: readonly WorkflowRunWorkflowFacet[] = [],
): WorkflowRunFacets {
  return {
    workflow: workflowFacetValues(runs, workflows, criteria.workflow),
    branch: facetValues(runs.map(workflowRunBranchLabel), criteria.branch),
    actor: facetValues(runs.map(workflowRunActor), criteria.actor),
    event: facetValues(
      runs.map((run) => run.triggerEvent),
      criteria.event,
    ),
  };
}

function workflowFacetValues(
  runs: readonly WorkflowRunListItem[],
  workflows: readonly WorkflowRunWorkflowFacet[],
  selected: string | undefined,
): WorkflowRunWorkflowFacet[] {
  const options = new Map(workflows.map((workflow) => [workflow.value, workflow]));
  for (const run of runs) {
    if (!options.has(run.definitionId)) {
      options.set(run.definitionId, {value: run.definitionId, label: run.workflowName});
    }
  }
  if (selected && !options.has(selected)) {
    options.set(selected, {value: selected, label: selected});
  }
  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label));
}

/**
 * The run's local calendar date, which is both what the date filters bound and what the row's
 * relative time is derived from, so a filtered result never contradicts what a row shows.
 */
export function runCalendarDate(run: Pick<WorkflowRunListItem, 'createdAt'>): string | null {
  const date = new Date(run.createdAt);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function matchesFacet(selected: readonly string[] | undefined, value: string | null): boolean {
  if (!selected || selected.length === 0) return true;
  return value !== null && selected.includes(value);
}

function matchesDateBounds(run: WorkflowRunListItem, criteria: WorkflowRunFilterCriteria): boolean {
  if (!criteria.after && !criteria.before) return true;
  const date = runCalendarDate(run);
  if (date === null) return false;
  // Both bounds are inclusive, and `YYYY-MM-DD` sorts correctly as text.
  if (criteria.after && date < criteria.after) return false;
  if (criteria.before && date > criteria.before) return false;
  return true;
}

function facetValues(
  values: readonly (string | null)[],
  selected: readonly string[] | undefined,
): string[] {
  const present = values.filter((value): value is string => Boolean(value));
  return [...new Set([...present, ...(selected ?? [])])].sort((left, right) =>
    left.localeCompare(right),
  );
}
