import {QueryLoadError} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Table, TableBody, TableHead, TableHeader, TableRow} from '@shipfox/react-ui/table';
import {hasTriggerEventFilters} from '#core/trigger-event.js';
import {EventsFilterBar} from './events-filter-bar.js';
import {
  EventsListEmpty,
  EventsListNoMatches,
  EventsListSkeleton,
  EventsListStaleError,
} from './events-list-states.js';
import {TriggerEventRow} from './trigger-event-row.js';
import type {EventsListProps} from './types.js';

export function EventsList({
  events,
  query,
  facets,
  filters,
  onFiltersChange,
  workspaceSlug,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  selectedEventId,
  onSelectEvent,
}: EventsListProps) {
  const activeFilters = hasTriggerEventFilters(filters);
  const refreshFailed = query.isError && query.data !== undefined;
  const showEmptyState = !query.isPending && !query.isError && events.length === 0;

  function clearFilters() {
    onFiltersChange({
      source: undefined,
      event: undefined,
      outcome: undefined,
      from: undefined,
      to: undefined,
    });
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base">
      <EventsFilterBar
        filters={filters}
        onFiltersChange={onFiltersChange}
        sources={facets?.sources}
        events={facets?.events}
        hasActiveFilters={activeFilters}
        onClear={clearFilters}
      />

      {query.isPending ? <EventsListSkeleton /> : null}
      {!query.isPending ? <QueryLoadError query={query} subject="events" icon="pulseLine" /> : null}
      {!query.isPending && refreshFailed ? <EventsListStaleError query={query} /> : null}
      {showEmptyState && !activeFilters ? <EventsListEmpty workspaceSlug={workspaceSlug} /> : null}
      {showEmptyState && activeFilters ? <EventsListNoMatches onClear={clearFilters} /> : null}

      {events.length > 0 ? (
        <>
          <Table>
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Result</TableHead>
                <TableHead className="text-right">Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TriggerEventRow
                  key={event.id}
                  event={event}
                  selected={event.id === selectedEventId}
                  onSelect={onSelectEvent}
                />
              ))}
            </TableBody>
          </Table>
          {hasNextPage ? (
            <div className="flex justify-center p-panel-compact">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                isLoading={isFetchingNextPage}
                onClick={onLoadMore}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
