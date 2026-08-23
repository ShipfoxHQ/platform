import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {cn} from '@shipfox/react-ui/utils';
import {useEffect, useMemo, useState} from 'react';
import {EventsList} from '#components/events-list.js';
import {TriggerEventDetail} from '#components/trigger-event-detail.js';
import type {TriggerEventFilters, TriggerEventSummary} from '#core/trigger-event.js';
import {
  useTriggerEventFacetsQuery,
  useTriggerEventsInfiniteQuery,
} from '#hooks/api/trigger-events.js';

export interface EventsPageProps {
  workspaceId: string;
  workspaceSlug?: string | undefined;
  filters: TriggerEventFilters;
  onFiltersChange: (patch: Partial<TriggerEventFilters>) => void;
  selectedEventId?: string | undefined;
  onSelectedEventChange?: ((eventId: string | undefined) => void) | undefined;
}

/**
 * Workspace-scoped Events list. Router-agnostic: filters and their setter come in as props
 * (the settings wrapper binds them to the URL), so a story can drive it with local state.
 */
export function EventsPage({
  workspaceId,
  workspaceSlug,
  filters,
  onFiltersChange,
  selectedEventId: routeSelectedEventId,
  onSelectedEventChange,
}: EventsPageProps) {
  const query = useTriggerEventsInfiniteQuery(workspaceId, filters);
  const facetsQuery = useTriggerEventFacetsQuery(workspaceId);
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>(routeSelectedEventId);
  const [selectionIsFromRoute, setSelectionIsFromRoute] = useState(
    routeSelectedEventId !== undefined,
  );

  const events = useMemo<TriggerEventSummary[]>(
    () => query.data?.pages.flatMap((page) => page.events) ?? [],
    [query.data],
  );

  useEffect(() => {
    setSelectedEventId(routeSelectedEventId);
    setSelectionIsFromRoute(routeSelectedEventId !== undefined);
  }, [routeSelectedEventId]);

  useEffect(() => {
    if (
      !selectedEventId ||
      selectionIsFromRoute ||
      query.isPending ||
      query.isFetching ||
      query.isError
    )
      return;
    if (!events.some((event) => event.id === selectedEventId)) setSelectedEventId(undefined);
  }, [
    events,
    query.isError,
    query.isFetching,
    query.isPending,
    selectedEventId,
    selectionIsFromRoute,
  ]);

  function selectEvent(eventId: string) {
    setSelectionIsFromRoute(false);
    setSelectedEventId(eventId);
    onSelectedEventChange?.(eventId);
  }

  function clearSelectedEvent() {
    setSelectionIsFromRoute(false);
    setSelectedEventId(undefined);
    onSelectedEventChange?.(undefined);
  }

  return (
    <RelativeTimeProvider>
      <section className="@container flex min-w-0 flex-col gap-group" aria-label="Events">
        <div className="grid min-h-0 items-start gap-group @min-[820px]:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
          <div className={cn('min-w-0', selectedEventId && '@max-[820px]:hidden')}>
            <EventsList
              events={events}
              query={query}
              facets={facetsQuery.data}
              filters={filters}
              onFiltersChange={onFiltersChange}
              workspaceSlug={workspaceSlug}
              hasNextPage={query.hasNextPage}
              isFetchingNextPage={query.isFetchingNextPage}
              onLoadMore={() => {
                void query.fetchNextPage();
              }}
              selectedEventId={selectedEventId}
              onSelectEvent={selectEvent}
            />
          </div>
          <TriggerEventDetail
            workspaceId={workspaceId}
            workspaceSlug={workspaceSlug}
            eventId={selectedEventId}
            onBack={clearSelectedEvent}
          />
        </div>
      </section>
    </RelativeTimeProvider>
  );
}
