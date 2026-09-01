import {definitionsInfiniteQueryOptions} from '@shipfox/client-projects';
import {useInfiniteQuery} from '@tanstack/react-query';
import {useCallback, useEffect, useMemo, useState} from 'react';
import type {WorkflowRunWorkflowFacet} from '#components/workflow-run-list/run-display.js';
import type {WorkflowOptionsStatus} from '#components/workflow-run-list/types.js';

const WORKFLOW_OPTIONS_STALE_TIME_MS = 5 * 60_000;

/** Loads the project-wide workflow options only when the workflow chooser needs them. */
export function useWorkflowFilterOptions(projectId: string): {
  workflowOptions: WorkflowRunWorkflowFacet[];
  workflowOptionsStatus: WorkflowOptionsStatus;
  onOpenWorkflowOptions: () => void;
  onRetryWorkflowOptions: () => void;
} {
  const [requestedProjectId, setRequestedProjectId] = useState<string>();
  const loadAllRequested = requestedProjectId === projectId;
  // A previous project's definitions must never appear in this project's chooser.
  const {placeholderData: _placeholderData, ...configuredOptions} = definitionsInfiniteQueryOptions(
    loadAllRequested ? projectId : undefined,
  );
  const definitionsQuery = useInfiniteQuery({
    ...configuredOptions,
    staleTime: WORKFLOW_OPTIONS_STALE_TIME_MS,
  });
  const repeatedCursor = hasRepeatedCursor(
    definitionsQuery.data?.pages.at(-1)?.nextCursor,
    definitionsQuery.data?.pageParams,
  );

  useEffect(() => {
    if (
      !loadAllRequested ||
      !definitionsQuery.hasNextPage ||
      definitionsQuery.isFetchingNextPage ||
      definitionsQuery.isFetchNextPageError ||
      repeatedCursor
    ) {
      return;
    }
    void definitionsQuery.fetchNextPage();
  }, [
    definitionsQuery.fetchNextPage,
    definitionsQuery.hasNextPage,
    definitionsQuery.isFetchNextPageError,
    definitionsQuery.isFetchingNextPage,
    loadAllRequested,
    repeatedCursor,
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

  let workflowOptionsStatus: WorkflowOptionsStatus = 'ready';
  if (definitionsQuery.isError || definitionsQuery.isFetchNextPageError || repeatedCursor) {
    workflowOptionsStatus = 'error';
  } else if (
    loadAllRequested &&
    (definitionsQuery.isPending ||
      definitionsQuery.isFetchingNextPage ||
      definitionsQuery.hasNextPage)
  ) {
    workflowOptionsStatus = 'loading';
  }

  const onOpenWorkflowOptions = useCallback(() => {
    setRequestedProjectId(projectId);
  }, [projectId]);
  const onRetryWorkflowOptions = useCallback(() => {
    setRequestedProjectId(projectId);
    if (definitionsQuery.isFetchNextPageError) {
      void definitionsQuery.fetchNextPage();
      return;
    }
    void definitionsQuery.refetch();
  }, [
    definitionsQuery.fetchNextPage,
    definitionsQuery.isFetchNextPageError,
    definitionsQuery.refetch,
    projectId,
  ]);

  return {
    workflowOptions,
    workflowOptionsStatus,
    onOpenWorkflowOptions,
    onRetryWorkflowOptions,
  };
}

function hasRepeatedCursor(
  nextCursor: string | null | undefined,
  pageParams: readonly (string | undefined)[] | undefined,
): boolean {
  return Boolean(nextCursor && pageParams?.includes(nextCursor));
}
