import {screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useWorkflowRunsInfiniteQuery} from '#hooks/api/workflow-runs.js';
import {workflowRunListItem} from '#test/fixtures/workflow-run.js';
import {renderWithRouter} from '#test/render.js';
import {WorkflowRunList} from './workflow-run-list.js';

vi.mock('#hooks/api/workflow-runs.js', () => ({
  useWorkflowRunsInfiniteQuery: vi.fn(),
}));

const useWorkflowRunsInfiniteQueryMock = vi.mocked(useWorkflowRunsInfiniteQuery);
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const ORIGIN_FILTER_RE = /^Origin\b.*filter$/u;

describe('WorkflowRunList', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test('sends an uncontrolled origin selection back to the server query', async () => {
    const syncedRun = workflowRunListItem({id: 'run-synced', name: 'deploy-web'});
    const devRun = workflowRunListItem({
      id: 'run-dev',
      name: 'triage-sentry',
      origin: 'dev',
      dev_source: {
        ref: 'fix-triage-prompt',
        commit: 'abcdef1234567890abcdef1234567890abcdef12',
        config_path: '.shipfox/workflows/triage-sentry.yml',
        initiated_by_user_id: '99999999-9999-4999-8999-999999999999',
        replay_of_event_id: null,
      },
    });
    useWorkflowRunsInfiniteQueryMock.mockReturnValue({
      data: {
        pages: [{runs: [syncedRun, devRun], nextCursor: null, filteredTotalCount: 2}],
        pageParams: [undefined],
      },
      isPending: false,
      isError: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useWorkflowRunsInfiniteQuery>);

    const user = userEvent.setup();
    renderWithRouter(
      <WorkflowRunList projectId={PROJECT_ID} workspaceSlug="acme" projectSlug="checkout-api" />,
    );

    await screen.findByText('deploy-web');
    expect(useWorkflowRunsInfiniteQueryMock).toHaveBeenCalledWith(PROJECT_ID, {
      origin: undefined,
    });
    await user.click(await screen.findByRole('button', {name: ORIGIN_FILTER_RE}));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitemradio', {name: 'Dev'}));

    expect(useWorkflowRunsInfiniteQueryMock).toHaveBeenLastCalledWith(PROJECT_ID, {
      origin: 'dev',
    });
    expect(screen.getByText('triage-sentry')).toBeInTheDocument();
    expect(screen.queryByText('deploy-web')).not.toBeInTheDocument();
  });
});
