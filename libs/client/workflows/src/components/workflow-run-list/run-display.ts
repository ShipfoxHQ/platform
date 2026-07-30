import type {WorkflowRunListItem, WorkflowRunStatus} from '#core/workflow-run.js';
import type {WorkflowRunListStatusFilter} from './types.js';

export function runMatchesSearch(run: WorkflowRunListItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  const haystack = `${run.id} ${run.name} ${run.status} ${run.triggerLabel}`.toLowerCase();
  return haystack.includes(needle);
}

const IN_PROGRESS_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set(['pending', 'running']);

export function runMatchesStatusFilter(
  status: WorkflowRunStatus,
  filter: WorkflowRunListStatusFilter,
): boolean {
  if (filter === 'all') return true;
  // "Running" reads as in-progress: it covers freshly-queued `pending` runs (including the
  // optimistic manual run inserted on fire) so they are not hidden the moment the filter is on.
  if (filter === 'running') return IN_PROGRESS_STATUSES.has(status);
  return status === filter;
}
