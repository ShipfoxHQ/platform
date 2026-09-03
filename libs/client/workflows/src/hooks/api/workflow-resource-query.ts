import type {QueryFunction, QueryKey, UseQueryOptions} from '@tanstack/react-query';

export const WORKFLOW_RESOURCE_ACTIVE_POLL_MS = 4_000;
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
