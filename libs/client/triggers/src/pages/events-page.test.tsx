import type {
  TriggerEventDetailResponseDto,
  TriggerEventListItemDto,
} from '@shipfox/api-triggers-dto';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {toTriggerEventDetail, toTriggerEventListPage} from '#hooks/api/trigger-event-mapper.js';
import {
  useTriggerEventFacetsQuery,
  useTriggerEventQuery,
  useTriggerEventsInfiniteQuery,
} from '#hooks/api/trigger-events.js';
import {EventsPage} from './events-page.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const EVENTS_HEADING = /^Events$/u;

const useTriggerEventsInfiniteQueryMock = vi.mocked(useTriggerEventsInfiniteQuery);
const useTriggerEventFacetsQueryMock = vi.mocked(useTriggerEventFacetsQuery);
const useTriggerEventQueryMock = vi.mocked(useTriggerEventQuery);

function makeEvent(overrides: Partial<TriggerEventListItemDto> = {}): TriggerEventListItemDto {
  return {
    id: EVENT_ID,
    event_ref: 'github:delivery-179:push',
    origin: 'integration',
    workspace_id: WORKSPACE_ID,
    provider: 'github',
    source: 'github',
    event: 'push',
    delivery_id: 'delivery-179',
    connection_id: '33333333-3333-4333-8333-333333333333',
    outcome: 'routed',
    matched_count: 1,
    received_at: '2026-06-25T19:30:00.000Z',
    processed_at: '2026-06-25T19:30:02.000Z',
    created_at: '2026-06-25T19:30:00.000Z',
    ...overrides,
  };
}

function makeDetail(overrides: Partial<TriggerEventDetailResponseDto> = {}) {
  return {
    ...makeEvent(),
    connection_name: 'ShipfoxHQ Production',
    payload: {ref: 'refs/heads/main'},
    decisions: [],
    ...overrides,
  };
}

function makeListQuery(triggerEvents: TriggerEventListItemDto[]) {
  const page = toTriggerEventListPage({
    trigger_events: triggerEvents,
    next_cursor: null,
  });

  return {
    data: {pages: [page], pageParams: [undefined]},
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  } as unknown as ReturnType<typeof useTriggerEventsInfiniteQuery>;
}

describe('EventsPage', () => {
  beforeEach(() => {
    useTriggerEventFacetsQueryMock.mockReturnValue({
      data: {sources: [{value: 'github', count: 1}], events: [{value: 'push', count: 1}]},
    } as ReturnType<typeof useTriggerEventFacetsQuery>);
    useTriggerEventQueryMock.mockImplementation(
      (eventId) =>
        ({
          data: eventId ? toTriggerEventDetail(makeDetail({id: eventId})) : undefined,
          isError: false,
          refetch: vi.fn(),
        }) as unknown as ReturnType<typeof useTriggerEventQuery>,
    );
  });

  test('clears the selected detail when a settled refresh no longer includes the event', async () => {
    useTriggerEventsInfiniteQueryMock.mockReturnValue(makeListQuery([makeEvent()]));
    const {rerender} = render(
      <EventsPage workspaceId={WORKSPACE_ID} filters={{}} onFiltersChange={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole('button', {name: 'Open details for github · push'}));
    expect(screen.getByRole('button', {name: 'Back to events'})).toBeInTheDocument();
    expect(screen.queryByRole('heading', {name: EVENTS_HEADING})).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'A workspace-wide audit log of trigger events received from integrations, schedules, and manual trigger calls.',
      ),
    ).not.toBeInTheDocument();

    useTriggerEventsInfiniteQueryMock.mockReturnValue(makeListQuery([]));
    rerender(<EventsPage workspaceId={WORKSPACE_ID} filters={{}} onFiltersChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByRole('button', {name: 'Back to events'})).not.toBeInTheDocument();
    });
  });

  test('opens a selected event from route state even when it is outside the loaded page', async () => {
    useTriggerEventsInfiniteQueryMock.mockReturnValue(makeListQuery([]));

    render(
      <EventsPage
        workspaceId={WORKSPACE_ID}
        filters={{}}
        selectedEventId={EVENT_ID}
        onFiltersChange={vi.fn()}
      />,
    );

    expect(await screen.findByRole('button', {name: 'Back to events'})).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Events'})).toBeInTheDocument();
  });

  test('keeps a user-selected event eligible for auto-clear after route synchronization', async () => {
    useTriggerEventsInfiniteQueryMock.mockReturnValue(makeListQuery([makeEvent()]));
    const onSelectedEventChange = vi.fn();
    const {rerender} = render(
      <EventsPage
        workspaceId={WORKSPACE_ID}
        filters={{}}
        onFiltersChange={vi.fn()}
        onSelectedEventChange={onSelectedEventChange}
      />,
    );

    fireEvent.click(await screen.findByRole('button', {name: 'Open details for github · push'}));
    expect(onSelectedEventChange).toHaveBeenCalledWith(EVENT_ID);

    rerender(
      <EventsPage
        workspaceId={WORKSPACE_ID}
        filters={{}}
        selectedEventId={EVENT_ID}
        onFiltersChange={vi.fn()}
        onSelectedEventChange={onSelectedEventChange}
      />,
    );

    useTriggerEventsInfiniteQueryMock.mockReturnValue(makeListQuery([]));
    rerender(
      <EventsPage
        workspaceId={WORKSPACE_ID}
        filters={{}}
        selectedEventId={EVENT_ID}
        onFiltersChange={vi.fn()}
        onSelectedEventChange={onSelectedEventChange}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', {name: 'Back to events'})).not.toBeInTheDocument();
    });
  });
});
