import {READ_ANNOTATIONS_MAX_LIMIT, readAnnotationsResponseSchema} from '@shipfox/annotations-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {
  type InfiniteData,
  infiniteQueryOptions,
  type UseInfiniteQueryOptions,
  useInfiniteQuery,
} from '@tanstack/react-query';
import {useMemo} from 'react';
import {
  type RunAnnotationRecord,
  type RunAnnotationSummary,
  summarizeRunAnnotations,
} from '#core/run-annotation.js';
import {type RunAnnotationPage, toRunAnnotationPage} from './run-annotation-mapper.js';

/** Matches the run detail poll, so annotations and run state never disagree by more than a tick. */
const ACTIVE_POLL_MS = 4_000;

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
    workflow_run_id: workflowRunId,
    attempt: String(runAttempt),
    limit: String(READ_ANNOTATIONS_MAX_LIMIT),
  });
  if (cursor) params.set('cursor', cursor);

  return toRunAnnotationPage(
    await checkedApiRequest(readAnnotationsResponseSchema, `/annotations?${params.toString()}`, {
      signal,
    }),
  );
}

export interface RunAnnotationsQueryInput {
  workflowRunId: string | undefined;
  runAttempt: number | undefined;
  /** Poll while the run attempt is non-terminal, then settle. */
  live?: boolean | undefined;
}

export function runAnnotationsQueryOptions({
  workflowRunId,
  runAttempt,
  live = false,
}: RunAnnotationsQueryInput): RunAnnotationsQueryOptions {
  const enabled = Boolean(workflowRunId) && runAttempt !== undefined;

  // Polling stops once the reader has paged past the first page: the cursor bounding page 2 was
  // computed from page 1's last row, so a refetch that shifts that boundary can drop a range of
  // annotations into a between-pages gap.
  return infiniteQueryOptions({
    queryKey: workflowRunId
      ? runAnnotationsQueryKeys.list(workflowRunId, runAttempt)
      : ([...runAnnotationsQueryKeys.all, 'list'] as const),
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      listRunAnnotations({
        workflowRunId: workflowRunId ?? '',
        runAttempt: runAttempt ?? 1,
        cursor: pageParam,
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 2_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      if (!live) return false;
      const pages = query.state.data?.pages;
      return pages && pages.length > 1 ? false : ACTIVE_POLL_MS;
    },
    refetchIntervalInBackground: false,
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
  annotations: RunAnnotationRecord[] | undefined;
  summary: RunAnnotationSummary | undefined;
}

export function useRunAnnotationsQuery(input: RunAnnotationsQueryInput): RunAnnotationsQueryResult {
  const query = useInfiniteQuery(runAnnotationsQueryOptions(input));
  const pages = query.data?.pages;

  const annotations = useMemo(
    () => (pages ? pages.flatMap((page) => page.annotations) : undefined),
    [pages],
  );
  const summary = useMemo(
    () =>
      annotations
        ? summarizeRunAnnotations(annotations, {truncated: pages?.at(-1)?.hasMore ?? false})
        : undefined,
    [annotations, pages],
  );

  return {query, annotations, summary};
}
