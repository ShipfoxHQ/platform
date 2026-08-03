import {QueryLoadError} from '@shipfox/client-ui';
import type {WorkflowRunListItem} from '#core/workflow-run.js';
import type {WorkflowRunListQuery} from './types.js';
import {
  WorkflowRunListEmpty,
  WorkflowRunListLoadMore,
  WorkflowRunListNoMatches,
  WorkflowRunListSkeleton,
  WorkflowRunListStaleError,
} from './workflow-run-list-states.js';
import {WorkflowRunRowList} from './workflow-run-row.js';

interface WorkflowRunListContentProps {
  query: WorkflowRunListQuery;
  totalRuns: number;
  runs: WorkflowRunListItem[];
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  onLoadMore?: () => void;
}

export function WorkflowRunListContent({
  query,
  totalRuns,
  runs,
  workspaceSlug,
  projectSlug,
  hasActiveFilters,
  onClearFilters,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  onLoadMore,
}: WorkflowRunListContentProps) {
  const {isPending, isError} = query;
  // A refetch that fails after a prior success keeps the rows on screen behind a slim
  // banner. QueryLoadError owns the inverse case (errored before anything loaded) and
  // self-gates to nothing here once data exists. A failed fetch never renders as an empty
  // list: "nothing here" and "we could not find out" are different answers.
  const refreshFailed = isError && query.data !== undefined;
  // Keyed off "we have an answer" rather than "no error", so a stale refresh still reports
  // whether the filters match anything instead of leaving the list blank under the banner.
  const hasLoaded = !isPending && query.data !== undefined;
  // An empty result is only an empty *list* when no filter is on. With filters active it is a
  // no-matches state even at zero loaded runs, so the way out is clearing them.
  const showEmptyState = hasLoaded && totalRuns === 0 && !hasActiveFilters;
  const showNoMatches = hasLoaded && runs.length === 0 && !showEmptyState;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {isPending ? <WorkflowRunListSkeleton /> : null}
      {!isPending ? (
        <QueryLoadError query={query} subject="workflow runs" icon="pulseLine" />
      ) : null}
      {!isPending && refreshFailed ? <WorkflowRunListStaleError query={query} /> : null}
      {showEmptyState ? (
        <WorkflowRunListEmpty workspaceSlug={workspaceSlug} projectSlug={projectSlug} />
      ) : null}
      {showNoMatches ? (
        <WorkflowRunListNoMatches
          onClear={onClearFilters}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          isFetchNextPageError={isFetchNextPageError}
          {...(onLoadMore ? {onLoadMore} : {})}
        />
      ) : null}
      {!isPending && runs.length > 0 ? (
        <>
          <WorkflowRunRowList runs={runs} workspaceSlug={workspaceSlug} projectSlug={projectSlug} />
          <WorkflowRunListLoadMore
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            isFetchNextPageError={isFetchNextPageError}
            {...(onLoadMore ? {onLoadMore} : {})}
          />
        </>
      ) : null}
    </div>
  );
}
