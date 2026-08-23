import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {screen} from '@testing-library/react';
import {workflowRunDto, workflowRunListResponseDto} from '#test/fixtures/workflow-run.js';
import {renderWithRouter} from '#test/render.js';
import {WorkflowRunList} from './workflow-run-list.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const ORIGIN_FILTER_RE = /^Origin\b.*filter$/u;

describe('WorkflowRunList', () => {
  test('shows all run origins without exposing an Origin filter', async () => {
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
      expect(new URL(requestInputUrl(input)).searchParams.get('origin')).toBeNull();
      return Promise.resolve(
        jsonResponse(
          workflowRunListResponseDto({
            runs: [syncedRun, devRun],
            filtered_total_count: 2,
          }),
        ),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    renderWithRouter(
      <QueryClientProvider client={queryClient}>
        <WorkflowRunList projectId={PROJECT_ID} workspaceSlug="acme" projectSlug="checkout-api" />
      </QueryClientProvider>,
    );

    await screen.findByText('deploy-web');
    expect(screen.getByText('triage-sentry')).toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.every(
        ([input]) => new URL(requestInputUrl(input)).searchParams.get('origin') === null,
      ),
    ).toBe(true);
    expect(screen.queryByRole('button', {name: ORIGIN_FILTER_RE})).not.toBeInTheDocument();
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
