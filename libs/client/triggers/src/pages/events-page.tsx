import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {Header, Text} from '@shipfox/react-ui/typography';
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
}: EventsPageProps) {
  const query = useTriggerEventsInfiniteQuery(workspaceId, filters);
  const facetsQuery = useTriggerEventFacetsQuery(workspaceId);
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>();

  const events = useMemo<TriggerEventSummary[]>(
    () => query.data?.pages.flatMap((page) => page.events) ?? [],
    [query.data],
  );

  useEffect(() => {
    if (!selectedEventId || query.isPending || query.isFetching || query.isError) return;
    if (!events.some((event) => event.id === selectedEventId)) setSelectedEventId(undefined);
  }, [events, query.isError, query.isFetching, query.isPending, selectedEventId]);

  return (
    <RelativeTimeProvider>
      <section
        className="@container flex min-w-0 flex-col gap-16"
        aria-labelledby="trigger-events-heading"
      >
        <div className="flex flex-col gap-4">
          <Header id="trigger-events-heading" variant="h3">
            Events
          </Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            A workspace-wide audit log of trigger events received from integrations, schedules, and
            manual trigger calls.
          </Text>
        </div>

        <div className="grid min-h-0 items-start gap-16 @min-[820px]:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
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
              onSelectEvent={setSelectedEventId}
            />
          </div>
          <TriggerEventDetail
            workspaceSlug={workspaceSlug}
            eventId={selectedEventId}
            onBack={() => setSelectedEventId(undefined)}
          />
        </div>
      </section>
    </RelativeTimeProvider>
  );
}
