import {
  triggerEventDetailResponseSchema,
  triggerEventFacetsResponseSchema,
  triggerEventListResponseSchema,
} from '@shipfox/api-triggers-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {
  type FetchQueryOptions,
  type InfiniteData,
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  type UseInfiniteQueryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import {
  normalizeTriggerEventFilters,
  normalizeTriggerEventFilterValues,
  type TriggerEventFilters,
} from '#core/trigger-event.js';
import {
  toTriggerEventDetail,
  toTriggerEventFacets,
  toTriggerEventListPage,
} from './trigger-event-mapper.js';

export type {TriggerEventFilters} from '#core/trigger-event.js';

type TriggerEventsInfiniteQueryOptions = UseInfiniteQueryOptions<
  import('#core/trigger-event.js').TriggerEventListPage,
  Error,
  InfiniteData<import('#core/trigger-event.js').TriggerEventListPage, string | undefined>,
  ReturnType<typeof triggerEventsQueryKeys.list>,
  string | undefined
>;

type TriggerEventQueryOptions = FetchQueryOptions<
  import('#core/trigger-event.js').TriggerEventDetail,
  Error,
  import('#core/trigger-event.js').TriggerEventDetail,
  ReturnType<typeof triggerEventsQueryKeys.detail>
>;

type TriggerEventFacetsQueryOptions = FetchQueryOptions<
  import('#core/trigger-event.js').TriggerEventFacets,
  Error,
  import('#core/trigger-event.js').TriggerEventFacets,
  ReturnType<typeof triggerEventsQueryKeys.facets>
>;

function setListParam(
  params: URLSearchParams,
  name: string,
  values: readonly string[] | undefined,
) {
  const normalized = normalizeTriggerEventFilterValues(values);
  if (normalized) params.set(name, normalized.join(','));
}

export const triggerEventsQueryKeys = {
  all: ['trigger-events'] as const,
  lists: (workspaceId: string) => [...triggerEventsQueryKeys.all, 'list', workspaceId] as const,
  list: (workspaceId: string, filters: TriggerEventFilters, limit = 50) =>
    [
      ...triggerEventsQueryKeys.lists(workspaceId),
      limit,
      normalizeTriggerEventFilters(filters),
    ] as const,
  detail: (id: string) => [...triggerEventsQueryKeys.all, 'detail', id] as const,
  facets: (workspaceId: string) => [...triggerEventsQueryKeys.all, 'facets', workspaceId] as const,
};

export async function listTriggerEvents({
  workspaceId,
  filters = {},
  limit = 50,
  cursor,
  signal,
}: {
  workspaceId: string;
  filters?: TriggerEventFilters;
  limit?: number;
  cursor?: string | undefined;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({workspace_id: workspaceId, limit: String(limit)});
  if (cursor) params.set('cursor', cursor);
  setListParam(params, 'source', filters.source);
  setListParam(params, 'event', filters.event);
  setListParam(params, 'origin', filters.origin);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  setListParam(params, 'outcome', filters.outcome);
  // The picker only ever asks for the true side; the API accepts no `replayable=false`.
  if (filters.replayable) params.set('replayable', 'true');

  const response = await checkedApiRequest(
    triggerEventListResponseSchema,
    `/trigger-events?${params.toString()}`,
    {signal},
  );
  return toTriggerEventListPage(response);
}

export async function getTriggerEvent({id, signal}: {id: string; signal?: AbortSignal}) {
  const response = await checkedApiRequest(
    triggerEventDetailResponseSchema,
    `/trigger-events/${encodeURIComponent(id)}`,
    {signal},
  );
  return toTriggerEventDetail(response);
}

export function triggerEventsInfiniteQueryOptions(
  workspaceId: string,
  filters: TriggerEventFilters = {},
  limit = 50,
): TriggerEventsInfiniteQueryOptions {
  return infiniteQueryOptions({
    queryKey: triggerEventsQueryKeys.list(workspaceId, filters, limit),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      listTriggerEvents({workspaceId, filters, limit, cursor: pageParam, signal}),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useTriggerEventsInfiniteQuery(
  workspaceId: string | undefined,
  filters: TriggerEventFilters = {},
  limit = 50,
) {
  return useInfiniteQuery({
    ...triggerEventsInfiniteQueryOptions(workspaceId ?? '', filters, limit),
    enabled: Boolean(workspaceId),
  });
}

export function triggerEventQueryOptions(id: string): TriggerEventQueryOptions {
  return queryOptions({
    queryKey: triggerEventsQueryKeys.detail(id),
    queryFn: ({signal}) => getTriggerEvent({id, signal}),
  });
}

export function useTriggerEventQuery(id: string | undefined) {
  return useQuery({
    ...triggerEventQueryOptions(id ?? ''),
    enabled: Boolean(id),
  });
}

export async function getTriggerEventFacets({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({workspace_id: workspaceId});
  const response = await checkedApiRequest(
    triggerEventFacetsResponseSchema,
    `/trigger-events/facets?${params.toString()}`,
    {signal},
  );
  return toTriggerEventFacets(response);
}

export function triggerEventFacetsQueryOptions(
  workspaceId: string,
): TriggerEventFacetsQueryOptions {
  return queryOptions({
    queryKey: triggerEventsQueryKeys.facets(workspaceId),
    queryFn: ({signal}) => getTriggerEventFacets({workspaceId, signal}),
    staleTime: 5 * 60 * 1000,
  });
}

export function useTriggerEventFacetsQuery(workspaceId: string | undefined) {
  return useQuery({
    ...triggerEventFacetsQueryOptions(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  });
}
