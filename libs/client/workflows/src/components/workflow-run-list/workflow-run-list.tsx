import {useCallback, useMemo} from 'react';
import type {WorkflowRunListItem} from '#core/workflow-run.js';
import {useWorkflowRunsInfiniteQuery} from '#hooks/api/workflow-runs.js';
import type {WorkflowRunListProps} from './types.js';
import {WorkflowRunListView} from './workflow-run-list-view.js';

export function WorkflowRunList({
  projectId,
  workspaceSlug,
  projectSlug,
  className,
  search,
  onFiltersChange,
  onClearFilters,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  onLoadMore,
}: WorkflowRunListProps) {
  const query = useWorkflowRunsInfiniteQuery(projectId, {});
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
      {...(search ? {search} : {})}
      {...(onFiltersChange ? {onFiltersChange} : {})}
      {...(onClearFilters ? {onClearFilters} : {})}
      hasNextPage={hasNextPage ?? query.hasNextPage}
      isFetchingNextPage={isFetchingNextPage ?? query.isFetchingNextPage}
      isFetchNextPageError={isFetchNextPageError ?? query.isFetchNextPageError}
      onLoadMore={onLoadMore ?? handleLoadMore}
    />
  );
}
