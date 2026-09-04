import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryFunction,
  type QueryKey,
  type UseInfiniteQueryOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';

export const WORKFLOW_RESOURCE_ACTIVE_POLL_MS = 4_000;
export const WORKFLOW_RESOURCE_ERROR_POLL_MS = 15_000;
export const WORKFLOW_RESOURCE_STALE_TIME_MS = 2_000;

type WorkflowResourceQueryOptions<TData, TQueryKey extends QueryKey> = Pick<
  UseQueryOptions<TData, Error, TData, TQueryKey>,
  | 'enabled'
  | 'queryFn'
  | 'queryKey'
  | 'refetchInterval'
  | 'refetchIntervalInBackground'
  | 'refetchOnWindowFocus'
  | 'staleTime'
>;

export function workflowResourceQueryOptions<TData, TQueryKey extends QueryKey>({
  queryKey,
  queryFn,
  enabled,
  isLive,
}: {
  queryKey: TQueryKey;
  queryFn: QueryFunction<TData, TQueryKey>;
  enabled: boolean;
  isLive: (data: TData | undefined) => boolean;
}): WorkflowResourceQueryOptions<TData, TQueryKey> {
  return {
    queryKey,
    queryFn,
    enabled,
    staleTime: (query) => (isLive(query.state.data) ? WORKFLOW_RESOURCE_STALE_TIME_MS : Infinity),
    refetchOnWindowFocus: (query) => isLive(query.state.data),
    refetchInterval: (query) => {
      if (!enabled || query.state.error !== null || !isLive(query.state.data)) return false;
      return WORKFLOW_RESOURCE_ACTIVE_POLL_MS;
    },
    refetchIntervalInBackground: false,
  };
}

type PaginatedWorkflowResourceQueryOptions<
  TPage extends {nextCursor: string | null},
  TQueryKey extends QueryKey,
> = UseInfiniteQueryOptions<
  TPage,
  Error,
  InfiniteData<TPage, string | undefined>,
  TQueryKey,
  string | undefined
>;

/**
 * Shared lifecycle for mutable cursor-paged run resources.
 *
 * Polling and focus refetch stop after page two has been derived from page one's cursor. Refetching
 * page one after that point could shift its boundary and leave rows between the two cached pages.
 * A live first page keeps a slower heartbeat after a transient error so it can recover without the
 * reader having to notice and activate a retry control.
 */
export function paginatedWorkflowResourceQueryOptions<
  TPage extends {nextCursor: string | null},
  TQueryKey extends QueryKey,
>({
  queryKey,
  queryFn,
  enabled,
  live,
}: {
  queryKey: TQueryKey;
  queryFn: QueryFunction<TPage, TQueryKey, string | undefined>;
  enabled: boolean;
  live: boolean;
}): PaginatedWorkflowResourceQueryOptions<TPage, TQueryKey> {
  return infiniteQueryOptions({
    queryKey,
    queryFn,
    enabled,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: WORKFLOW_RESOURCE_STALE_TIME_MS,
    refetchOnWindowFocus: (query) => (query.state.data?.pages.length ?? 0) <= 1,
    refetchInterval: (query) => {
      if (!enabled || !live) return false;
      const pages = query.state.data?.pages;
      if (pages && pages.length > 1) return false;
      return query.state.error === null
        ? WORKFLOW_RESOURCE_ACTIVE_POLL_MS
        : WORKFLOW_RESOURCE_ERROR_POLL_MS;
    },
    refetchIntervalInBackground: false,
  });
}
