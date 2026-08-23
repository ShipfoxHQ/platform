import type {TriggerEventListItemDto} from '@shipfox/api-triggers-dto';
import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {toTriggerEventSummary} from '#hooks/api/trigger-event-mapper.js';
import {EventsList} from './events-list.js';
import type {EventsListProps} from './types.js';

function makeEvent(overrides: Partial<TriggerEventListItemDto> = {}) {
  return toTriggerEventSummary({
    id: 'evt-1',
    event_ref: 'ref-1',
    origin: 'integration',
    workspace_id: 'ws-1',
    provider: 'github',
    source: 'github_acme',
    event: 'push',
    replay_of_event_id: null,
    delivery_id: 'delivery-1',
    connection_id: 'conn-1',
    outcome: 'routed',
    matched_count: 2,
    received_at: '2026-06-01T00:00:00.000Z',
    processed_at: '2026-06-01T00:00:00.000Z',
    created_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  });
}

function makeProps(overrides: Partial<EventsListProps> = {}): EventsListProps {
  return {
    events: [makeEvent()],
    query: {
      isPending: false,
      isError: false,
      isFetching: false,
      data: {pages: [], pageParams: []},
      error: null,
      refetch: () => undefined,
    },
    facets: {sources: [{value: 'github_acme', count: 1}], events: [{value: 'push', count: 1}]},
    filters: {},
    onFiltersChange: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    onLoadMore: vi.fn(),
    selectedEventId: undefined,
    onSelectEvent: vi.fn(),
    ...overrides,
  };
}

function renderList(props: EventsListProps) {
  return render(
    <RelativeTimeProvider>
      <EventsList {...props} />
    </RelativeTimeProvider>,
  );
}

const FILTERS_TOGGLE = /Filters/u;

async function openFilters() {
  await userEvent.click(screen.getByRole('button', {name: FILTERS_TOGGLE}));
}

async function selectResult(label: string) {
  const user = userEvent.setup();

  await openFilters();
  await user.click(screen.getByRole('combobox', {name: 'Filter by result'}));
  await user.click(await screen.findByRole('option', {name: label}));
}

describe('EventsList', () => {
  test('renders the event list as a panel with a header strip', () => {
    renderList(makeProps());

    const panel = document.querySelector('[data-slot="panel"]');

    expect(panel).toBeInTheDocument();
    expect(panel?.querySelector('[data-slot="panel-header"]')).toBeInTheDocument();
  });

  test('renders a row per event with its match summary', () => {
    renderList(makeProps());

    expect(screen.getByText('Triggered 2 workflows')).toBeInTheDocument();
  });

  test('still renders rows when the facets query failed', () => {
    renderList(makeProps({facets: undefined}));

    expect(screen.getByText('Triggered 2 workflows')).toBeInTheDocument();
  });

  test('shows the no-matches state and clears active filters', async () => {
    const onFiltersChange = vi.fn();
    renderList(makeProps({events: [], filters: {outcome: ['failed']}, onFiltersChange}));

    expect(screen.getByText('No matching events')).toBeInTheDocument();

    // Both the filter bar and the empty state expose a "Clear filters" button; either clears.
    const [clearButton] = screen.getAllByRole('button', {name: 'Clear filters'});
    if (!clearButton) throw new Error('expected a Clear filters button');
    await userEvent.click(clearButton);

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({outcome: undefined}));
  });

  test('empty list filters do not count as active filters', () => {
    renderList(makeProps({filters: {source: [], event: [], outcome: []}}));

    expect(screen.getByText('Triggered 2 workflows')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Clear filters'})).not.toBeInTheDocument();
  });

  test('selecting a result reports the filter patch', async () => {
    const onFiltersChange = vi.fn();
    renderList(makeProps({onFiltersChange}));

    await selectResult('Triggered');

    expect(onFiltersChange).toHaveBeenCalledWith({outcome: ['routed']});
  });

  test('removing the last active result clears the filter to undefined', async () => {
    const onFiltersChange = vi.fn();
    renderList(makeProps({filters: {outcome: ['routed']}, onFiltersChange}));

    await openFilters();
    await userEvent.click(screen.getByLabelText('Remove Triggered'));

    expect(onFiltersChange).toHaveBeenCalledWith({outcome: undefined});
  });

  test('the Failed option folds errored in with failed', async () => {
    const onFiltersChange = vi.fn();
    renderList(makeProps({onFiltersChange}));

    await selectResult('Failed');

    expect(onFiltersChange).toHaveBeenCalledWith({outcome: ['failed', 'errored']});
  });

  test('an errored-only filter shows Failed as selected', async () => {
    renderList(makeProps({filters: {outcome: ['errored']}}));

    await openFilters();

    expect(screen.getByLabelText('Remove Failed')).toBeInTheDocument();
  });

  test('selects an event from the event cell button', async () => {
    const onSelectEvent = vi.fn();
    renderList(makeProps({onSelectEvent}));

    await userEvent.click(
      screen.getByRole('button', {name: 'Open details for github_acme · push'}),
    );

    expect(onSelectEvent).toHaveBeenCalledWith('evt-1');
  });

  test('selects an event when the row is clicked', async () => {
    const onSelectEvent = vi.fn();
    renderList(makeProps({onSelectEvent}));
    const row = screen.getByText('Triggered 2 workflows').closest('tr');
    if (!row) throw new Error('expected an event row');

    await userEvent.click(row);

    expect(onSelectEvent).toHaveBeenCalledWith('evt-1');
  });

  test('marks the selected event row', () => {
    renderList(makeProps({selectedEventId: 'evt-1'}));

    expect(
      screen.getByRole('button', {name: 'Open details for github_acme · push'}).closest('tr'),
    ).toHaveAttribute('data-selected', 'true');
  });
});
