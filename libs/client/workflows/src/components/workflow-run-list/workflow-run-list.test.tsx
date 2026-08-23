import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {workflowRunDto, workflowRunListResponseDto} from '#test/fixtures/workflow-run.js';
import {renderWithRouter} from '#test/render.js';
import {WorkflowRunList} from './workflow-run-list.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const ORIGIN_FILTER_RE = /^Origin\b.*filter$/u;

describe('WorkflowRunList', () => {
  test('sends an uncontrolled origin selection back to the server query', async () => {
    const syncedRun = workflowRunDto({
      id: '66666666-6666-4666-8666-000000000001',
      name: 'deploy-web',
    });
    const devRun = workflowRunDto({
      id: '66666666-6666-4666-8666-000000000002',
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
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(requestInputUrl(input));
      const runs = url.searchParams.get('origin') === 'dev' ? [devRun] : [syncedRun, devRun];

      return Promise.resolve(
        jsonResponse(workflowRunListResponseDto({runs, filtered_total_count: runs.length})),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const user = userEvent.setup();
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    renderWithRouter(
      <QueryClientProvider client={queryClient}>
        <WorkflowRunList projectId={PROJECT_ID} workspaceSlug="acme" projectSlug="checkout-api" />
      </QueryClientProvider>,
    );

    await screen.findByText('deploy-web');
    expect(
      fetchImpl.mock.calls.some(
        ([input]) => new URL(requestInputUrl(input)).searchParams.get('origin') === null,
      ),
    ).toBe(true);
    await user.click(await screen.findByRole('button', {name: ORIGIN_FILTER_RE}));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitemradio', {name: 'Dev'}));

    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.some(
          ([input]) => new URL(requestInputUrl(input)).searchParams.get('origin') === 'dev',
        ),
      ).toBe(true),
    );
    expect(screen.getByText('triage-sentry')).toBeInTheDocument();
    expect(screen.queryByText('deploy-web')).not.toBeInTheDocument();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
}

function requestInputUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return String(input);
}
