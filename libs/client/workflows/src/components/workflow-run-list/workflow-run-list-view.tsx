import {TimeTickerProvider} from '@shipfox/react-ui/time-ticker';
import {cn} from '@shipfox/react-ui/utils';
import {useState} from 'react';
import {runMatchesSearch, runMatchesStatusFilter} from './run-display.js';
import type {WorkflowRunListViewProps} from './types.js';
import {WorkflowRunListContent} from './workflow-run-list-content.js';
import {WorkflowRunListHeader} from './workflow-run-list-header.js';

export function WorkflowRunListView({
  runs,
  query,
  workspaceSlug,
  projectSlug,
  selectedWorkflowRunId,
  className,
  search = '',
  statusFilter = 'all',
  onFiltersChange,
  hasNextPage = false,
  isFetchingNextPage = false,
  isFetchNextPageError = false,
  onLoadMore,
}: WorkflowRunListViewProps) {
  const [localSearch, setLocalSearch] = useState(search);
  const [localStatusFilter, setLocalStatusFilter] = useState(statusFilter);
  const currentSearch = onFiltersChange ? search : localSearch;
  const currentStatusFilter = onFiltersChange ? statusFilter : localStatusFilter;

  const filteredRuns = runs.filter((run) => {
    if (!runMatchesStatusFilter(run.status, currentStatusFilter)) return false;
    return runMatchesSearch(run, currentSearch);
  });

  function handleClearFilters() {
    if (onFiltersChange) onFiltersChange({search: '', status: 'all'});
    else {
      setLocalSearch('');
      setLocalStatusFilter('all');
    }
  }

  return (
    <TimeTickerProvider intervalMs={1000} reducedMotionIntervalMs={10_000}>
      <aside
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background-subtle-base',
          className,
        )}
        aria-label="Workflow runs"
      >
        <WorkflowRunListHeader
          query={currentSearch}
          onQueryChange={(next) => {
            if (onFiltersChange) onFiltersChange({search: next, status: currentStatusFilter});
            else setLocalSearch(next);
          }}
          statusFilter={currentStatusFilter}
          onStatusFilterChange={(next) => {
            if (onFiltersChange) onFiltersChange({search: currentSearch, status: next});
            else setLocalStatusFilter(next);
          }}
        />
        <WorkflowRunListContent
          query={query}
          totalRuns={runs.length}
          runs={filteredRuns}
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          selectedWorkflowRunId={selectedWorkflowRunId}
          onClearFilters={handleClearFilters}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          isFetchNextPageError={isFetchNextPageError}
          {...(onLoadMore ? {onLoadMore} : {})}
        />
      </aside>
    </TimeTickerProvider>
  );
}
