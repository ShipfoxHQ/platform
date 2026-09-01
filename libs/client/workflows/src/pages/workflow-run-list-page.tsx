import {useDefinitionsInfiniteQuery} from '@shipfox/client-projects';
import {useNavigate} from '@tanstack/react-router';
import {useCallback, useEffect, useMemo} from 'react';
import {WorkflowRunList} from '#components/workflow-run-list/workflow-run-list.js';
import {
  applyWorkflowRunFilterPatch,
  clearWorkflowRunFilters,
  type WorkflowRunFilterPatch,
  type WorkflowRunsSearch,
  workflowRunSearchParams,
} from '#routes/inputs.js';

interface WorkflowRunsPageProps {
  projectId: string;
  workspaceSlug: string;
  projectSlug: string;
  search?: WorkflowRunsSearch;
}

const EMPTY_SEARCH: WorkflowRunsSearch = {};

export function WorkflowRunsPage({
  projectId,
  workspaceSlug,
  projectSlug,
  search = EMPTY_SEARCH,
}: WorkflowRunsPageProps) {
  const navigate = useNavigate();
  const definitionsQuery = useDefinitionsInfiniteQuery(projectId);
  const {
    fetchNextPage: fetchNextDefinitionsPage,
    hasNextPage: hasNextDefinitionsPage,
    isFetchingNextPage: isFetchingNextDefinitionsPage,
    isFetchNextPageError: isFetchNextDefinitionsPageError,
  } = definitionsQuery;

  // The selector represents the project, not merely the first API page. Fetch successive
  // definition pages in the background so workflows without recent runs remain selectable.
  useEffect(() => {
    if (
      hasNextDefinitionsPage &&
      !isFetchingNextDefinitionsPage &&
      !isFetchNextDefinitionsPageError
    ) {
      void fetchNextDefinitionsPage();
    }
  }, [
    fetchNextDefinitionsPage,
    hasNextDefinitionsPage,
    isFetchingNextDefinitionsPage,
    isFetchNextDefinitionsPageError,
  ]);

  const workflowOptions = useMemo(
    () =>
      definitionsQuery.data?.pages.flatMap((page) =>
        page.definitions.map((definition) => ({
          value: definition.id,
          label: definition.name,
        })),
      ) ?? [],
    [definitionsQuery.data],
  );
  let workflowOptionsStatus: 'loading' | 'ready' | 'error' = 'ready';
  if (definitionsQuery.isError || definitionsQuery.isFetchNextPageError) {
    workflowOptionsStatus = 'error';
  } else if (
    definitionsQuery.isPending ||
    definitionsQuery.isFetchingNextPage ||
    definitionsQuery.hasNextPage
  ) {
    workflowOptionsStatus = 'loading';
  }
  const retryWorkflowOptions = useCallback(() => {
    if (definitionsQuery.isFetchNextPageError) {
      void definitionsQuery.fetchNextPage();
      return;
    }
    void definitionsQuery.refetch();
  }, [
    definitionsQuery.fetchNextPage,
    definitionsQuery.isFetchNextPageError,
    definitionsQuery.refetch,
  ]);

  // Filter changes replace history instead of pushing it, so Back leaves the list rather than
  // walking every keystroke of a search box.
  const commitSearch = useCallback(
    (next: WorkflowRunsSearch) => {
      navigate({
        search: workflowRunSearchParams(next, {}) as never,
        replace: true,
      });
    },
    [navigate],
  );

  const onFiltersChange = useCallback(
    (patch: WorkflowRunFilterPatch) => commitSearch(applyWorkflowRunFilterPatch(search, patch)),
    [commitSearch, search],
  );

  const onClearFilters = useCallback(
    () => commitSearch(clearWorkflowRunFilters(search)),
    [commitSearch, search],
  );

  return (
    <div data-workflow-page-root="runs" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <WorkflowRunList
        projectId={projectId}
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        workflowOptions={workflowOptions}
        workflowOptionsStatus={workflowOptionsStatus}
        onRetryWorkflowOptions={retryWorkflowOptions}
        search={search}
        onFiltersChange={onFiltersChange}
        onClearFilters={onClearFilters}
      />
    </div>
  );
}
