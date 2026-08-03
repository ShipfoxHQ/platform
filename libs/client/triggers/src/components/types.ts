import type {QueryLoadErrorQuery} from '@shipfox/client-ui';
import type {
  TriggerEventFacets,
  TriggerEventFilters,
  TriggerEventSummary,
} from '#core/trigger-event.js';

export type TriggerEventsListQuery = QueryLoadErrorQuery & {isPending: boolean};

export interface EventsListProps {
  events: TriggerEventSummary[];
  query: TriggerEventsListQuery;
  facets: TriggerEventFacets | undefined;
  filters: TriggerEventFilters;
  onFiltersChange: (patch: Partial<TriggerEventFilters>) => void;
  workspaceSlug?: string | undefined;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  selectedEventId?: string | undefined;
  onSelectEvent: (eventId: string) => void;
}
