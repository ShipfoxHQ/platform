import {TimeTickerProvider} from '@shipfox/react-ui/time-ticker';
import {Header} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {useId, useMemo, useState} from 'react';
import {
  applyWorkflowRunFilterPatch,
  clearWorkflowRunFilters,
  hasWorkflowRunFilters,
  type WorkflowRunFilterPatch,
  type WorkflowRunsSearch,
} from '#routes/inputs.js';
import {runMatchesFilters, workflowRunFacets} from './run-display.js';
import type {WorkflowRunListViewProps} from './types.js';
import {WorkflowRunFilters} from './workflow-run-filters.js';
import {WorkflowRunListContent} from './workflow-run-list-content.js';

const EMPTY_SEARCH: WorkflowRunsSearch = {};

export function WorkflowRunListView({
  runs,
  query,
  workspaceSlug,
  projectSlug,
  className,
  search = EMPTY_SEARCH,
  onFiltersChange,
  onClearFilters,
  hasNextPage = false,
  isFetchingNextPage = false,
  isFetchNextPageError = false,
  onLoadMore,
}: WorkflowRunListViewProps) {
  const headingId = useId();
  const [localSearch, setLocalSearch] = useState<WorkflowRunsSearch>(search);
  const currentSearch = onFiltersChange ? search : localSearch;

  const filteredRuns = useMemo(
    () => runs.filter((run) => runMatchesFilters(run, currentSearch)),
    [runs, currentSearch],
  );
  const facets = useMemo(() => workflowRunFacets(runs, currentSearch), [runs, currentSearch]);
  const hasActiveFilters = hasWorkflowRunFilters(currentSearch);

  function handleFiltersChange(patch: WorkflowRunFilterPatch) {
    if (onFiltersChange) onFiltersChange(patch);
    else setLocalSearch((previous) => applyWorkflowRunFilterPatch(previous, patch));
  }

  function handleClearFilters() {
    if (onClearFilters) onClearFilters();
    else if (onFiltersChange) onFiltersChange(CLEAR_ALL_FILTERS);
    else setLocalSearch(clearWorkflowRunFilters);
  }

  return (
    <TimeTickerProvider intervalMs={1000} reducedMotionIntervalMs={10_000}>
      <section
        aria-labelledby={headingId}
        className={cn('flex min-h-0 min-w-0 flex-1 flex-col gap-12', className)}
      >
        {/* The tab strip above already reads "Runs", so the page heading is for structure and
            assistive tech rather than a second visible title competing with it. */}
        <Header id={headingId} variant="h1" className="sr-only">
          Workflow runs
        </Header>

        <WorkflowRunFilters
          search={currentSearch}
          facets={facets}
          onChange={handleFiltersChange}
          onClear={handleClearFilters}
          hasActiveFilters={hasActiveFilters}
        />

        <WorkflowRunListContent
          query={query}
          totalRuns={runs.length}
          runs={filteredRuns}
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={handleClearFilters}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          isFetchNextPageError={isFetchNextPageError}
          {...(onLoadMore ? {onLoadMore} : {})}
        />
      </section>
    </TimeTickerProvider>
  );
}

const CLEAR_ALL_FILTERS: WorkflowRunFilterPatch = {
  search: undefined,
  status: undefined,
  branch: undefined,
  actor: undefined,
  event: undefined,
  after: undefined,
  before: undefined,
};
