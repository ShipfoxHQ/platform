import {
  WORKFLOW_RUN_ANNOTATIONS_PAGE_LIMIT,
  workflowRunAnnotationsResponseSchema,
} from '@shipfox/api-workflows-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {
  type InfiniteData,
  type UseInfiniteQueryOptions,
  useInfiniteQuery,
} from '@tanstack/react-query';
import {useEffect, useMemo} from 'react';
import {
  type RunAnnotationEntry,
  type RunAnnotationSummary,
  summarizeRunAnnotations,
} from '#core/run-annotation.js';
import {type RunAnnotationPage, toRunAnnotationPage} from './run-annotation-mapper.js';
import {paginatedWorkflowResourceQueryOptions} from './workflow-resource-query.js';

export const runAnnotationsQueryKeys = {
  all: ['run-annotations'] as const,
  list: (workflowRunId: string, runAttempt?: number | undefined) =>
    [...runAnnotationsQueryKeys.all, 'list', workflowRunId, runAttempt ?? null] as const,
};

type RunAnnotationsQueryKey =
  | ReturnType<typeof runAnnotationsQueryKeys.list>
  | readonly ['run-annotations', 'list'];

type RunAnnotationsQueryOptions = UseInfiniteQueryOptions<
  RunAnnotationPage,
  Error,
  InfiniteData<RunAnnotationPage, string | undefined>,
  RunAnnotationsQueryKey,
  string | undefined
>;

async function listRunAnnotations({
  workflowRunId,
  runAttempt,
  cursor,
  signal,
}: {
  workflowRunId: string;
  runAttempt: number;
  cursor?: string | undefined;
  signal?: AbortSignal;
}): Promise<RunAnnotationPage> {
  const params = new URLSearchParams({
    attempt: String(runAttempt),
    limit: String(WORKFLOW_RUN_ANNOTATIONS_PAGE_LIMIT),
  });
  if (cursor) params.set('cursor', cursor);

  return toRunAnnotationPage(
    await checkedApiRequest(
      workflowRunAnnotationsResponseSchema,
      `/workflows/runs/${workflowRunId}/annotations?${params.toString()}`,
      {signal},
    ),
  );
}

export interface RunAnnotationsQueryInput {
  workflowRunId: string | undefined;
  runAttempt: number | undefined;
  enabled?: boolean | undefined;
  /** Poll while the run attempt is non-terminal, then settle. */
  live?: boolean | undefined;
  /** Fetch every page for consumers that need an exact run-wide aggregate. */
  loadAllPages?: boolean | undefined;
}

export function runAnnotationsQueryOptions({
  workflowRunId,
  runAttempt,
  enabled: enabledOption = true,
  live = false,
}: RunAnnotationsQueryInput): RunAnnotationsQueryOptions {
  const enabled = Boolean(workflowRunId) && runAttempt !== undefined && enabledOption;

  return paginatedWorkflowResourceQueryOptions({
    queryKey: workflowRunId
      ? runAnnotationsQueryKeys.list(workflowRunId, runAttempt)
      : ([...runAnnotationsQueryKeys.all, 'list'] as const),
    enabled,
    live,
    queryFn: ({pageParam, signal}) =>
      listRunAnnotations({
        workflowRunId: workflowRunId ?? '',
        runAttempt: runAttempt ?? 1,
        cursor: pageParam,
        signal,
      }),
  });
}

export interface RunAnnotationsQueryResult {
  query: ReturnType<
    typeof useInfiniteQuery<
      RunAnnotationPage,
      Error,
      InfiniteData<RunAnnotationPage, string | undefined>,
      RunAnnotationsQueryKey,
      string | undefined
    >
  >;
  /** `undefined` until the first page resolves, so counts never render a speculative zero. */
  entries: RunAnnotationEntry[] | undefined;
  summary: RunAnnotationSummary | undefined;
}

export function useRunAnnotationsQuery(input: RunAnnotationsQueryInput): RunAnnotationsQueryResult {
  const query = useInfiniteQuery(runAnnotationsQueryOptions(input));
  const pages = query.data?.pages;

  useEffect(() => {
    if (!input.loadAllPages || !query.hasNextPage || query.isFetchingNextPage || query.isError) {
      return;
    }
    void query.fetchNextPage();
  }, [
    input.loadAllPages,
    query.fetchNextPage,
    query.hasNextPage,
    query.isError,
    query.isFetchingNextPage,
  ]);

  const entries = useMemo(
    () => (pages ? pages.flatMap((page) => page.entries) : undefined),
    [pages],
  );
  const summary = useMemo(
    () =>
      entries
        ? summarizeRunAnnotations(
            entries.map((entry) => entry.annotation),
            {truncated: pages?.at(-1)?.nextCursor !== null},
          )
        : undefined,
    [entries, pages],
  );

  return {query, entries, summary};
}
