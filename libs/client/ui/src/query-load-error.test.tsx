import {ApiError} from '@shipfox/client-api';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryLoadError, type QueryLoadErrorQuery} from './query-load-error.js';

function buildQuery(overrides: Partial<QueryLoadErrorQuery> = {}): QueryLoadErrorQuery {
  return {
    isError: true,
    isFetching: false,
    data: undefined,
    error: new ApiError({message: 'boom', code: 'network-error', status: 0}),
    refetch: vi.fn(),
    ...overrides,
  };
}

describe('QueryLoadError', () => {
  it('renders the placeholder when the query errored with no data loaded', () => {
    const query = buildQuery();

    render(<QueryLoadError query={query} subject="integrations" />);

    expect(screen.getByText("Couldn't load integrations")).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Retry loading integrations'})).toBeInTheDocument();
  });

  it('passes the panel variant through to the placeholder', () => {
    const query = buildQuery();

    const {container} = render(
      <QueryLoadError query={query} subject="integrations" variant="panel" />,
    );

    expect(container.querySelector('[data-slot="empty-state"]')).toHaveAttribute(
      'data-variant',
      'panel',
    );
  });

  it('renders nothing when stale data is present (a refetch failed after a prior success)', () => {
    const query = buildQuery({data: {connections: []}});

    const {container} = render(<QueryLoadError query={query} subject="integrations" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the query is not in an error state', () => {
    const query = buildQuery({isError: false});

    const {container} = render(<QueryLoadError query={query} subject="integrations" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('calls refetch when Retry is clicked', async () => {
    const query = buildQuery();

    render(<QueryLoadError query={query} subject="integrations" />);
    await userEvent.click(screen.getByRole('button', {name: 'Retry loading integrations'}));

    expect(query.refetch).toHaveBeenCalledOnce();
  });

  it('disables Retry while a refetch is in flight', () => {
    const query = buildQuery({isFetching: true});

    render(<QueryLoadError query={query} subject="integrations" />);

    expect(screen.getByRole('button', {name: 'Retry loading integrations'})).toBeDisabled();
  });
});
