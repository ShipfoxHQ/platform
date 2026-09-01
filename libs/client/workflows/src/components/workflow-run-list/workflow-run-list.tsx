import {useCallback, useMemo, useState} from 'react';
import type {WorkflowRunListItem} from '#core/workflow-run.js';
import {useWorkflowRunsInfiniteQuery} from '#hooks/api/workflow-runs.js';
import {
  applyWorkflowRunFilterPatch,
  clearWorkflowRunFilters,
  type WorkflowRunFilterPatch,
  type WorkflowRunsSearch,
} from '#routes/inputs.js';
import type {WorkflowRunListProps} from './types.js';
import {WorkflowRunListView} from './workflow-run-list-view.js';

const EMPTY_SEARCH: WorkflowRunsSearch = {};

export function WorkflowRunList({
  projectId,
  workspaceSlug,
  projectSlug,
  className,
  workflowOptions,
  workflowOptionsStatus,
  onRetryWorkflowOptions,
  search,
  onFiltersChange,
  onClearFilters,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  onLoadMore,
}: WorkflowRunListProps) {
  const [localSearch, setLocalSearch] = useState(search ?? EMPTY_SEARCH);
  const effectiveSearch = onFiltersChange ? search : localSearch;
  const handleFiltersChange = onFiltersChange ?? handleLocalFiltersChange;
  const handleClearFilters = onFiltersChange ? onClearFilters : handleLocalClearFilters;

  // Origin and workflow are server-backed so those filters cover the full run history. The
  // remaining dimensions stay client-side over the pages the user has loaded.
  const query = useWorkflowRunsInfiniteQuery(projectId, {
    origin: effectiveSearch?.origin,
    definitionId: effectiveSearch?.workflow,
  });
  const handleLoadMore = useCallback(() => {
    void query.fetchNextPage();
  }, [query.fetchNextPage]);
  const runs = useMemo<WorkflowRunListItem[]>(
    () => query.data?.pages.flatMap((page) => page.runs) ?? [],
    [query.data],
  );

  return (
    <WorkflowRunListView
      runs={runs}
      query={query}
      workspaceSlug={workspaceSlug}
      projectSlug={projectSlug}
      className={className}
      {...(workflowOptions ? {workflowOptions} : {})}
      {...(workflowOptionsStatus ? {workflowOptionsStatus} : {})}
      {...(onRetryWorkflowOptions ? {onRetryWorkflowOptions} : {})}
      {...(effectiveSearch ? {search: effectiveSearch} : {})}
      onFiltersChange={handleFiltersChange}
      {...(handleClearFilters ? {onClearFilters: handleClearFilters} : {})}
      hasNextPage={hasNextPage ?? query.hasNextPage}
      isFetchingNextPage={isFetchingNextPage ?? query.isFetchingNextPage}
      isFetchNextPageError={isFetchNextPageError ?? query.isFetchNextPageError}
      onLoadMore={onLoadMore ?? handleLoadMore}
    />
  );

  function handleLocalFiltersChange(patch: WorkflowRunFilterPatch) {
    setLocalSearch((previous) => applyWorkflowRunFilterPatch(previous, patch));
  }

  function handleLocalClearFilters() {
    setLocalSearch(clearWorkflowRunFilters);
    onClearFilters?.();
  }
}
