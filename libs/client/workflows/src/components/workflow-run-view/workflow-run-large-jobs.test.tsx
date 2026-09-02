import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {type WorkflowRunOverview, WorkflowRunOverviewJob} from '#core/workflow-run.js';
import {workflowRunDetail} from '#test/fixtures/workflow-run.js';
import {WorkflowRunLargeJobs} from './workflow-run-large-jobs.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const FIRST_JOB_ID = '44444444-4444-4444-8444-000000000001';
const SECOND_JOB_ID = '44444444-4444-4444-8444-000000000002';

describe('WorkflowRunLargeJobs', () => {
  afterEach(() => {
    configureApiClient({baseUrl: '', fetchImpl: undefined});
  });

  test('retries a failed next-page read with fetchNextPage', async () => {
    const user = userEvent.setup();
    let nextPageAttempts = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input));
      expect(url.searchParams.get('cursor')).toBe('jobs-page-2');
      nextPageAttempts += 1;
      if (nextPageAttempts === 1) {
        return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
      }
      return Promise.resolve(
        jsonResponse({
          items: [
            {
              id: SECOND_JOB_ID,
              key: 'deploy',
              name: 'deploy',
              position: 1,
              status: 'succeeded',
              status_reason: null,
              mode: 'one_shot',
              listener_status: 'inactive',
              carried_over: false,
              execution_count: 1,
              execution_status_counts: {
                pending: 0,
                running: 0,
                succeeded: 1,
                failed: 0,
                cancelled: 0,
              },
              default_execution: null,
            },
          ],
          next_cursor: null,
          total: 2,
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    render(
      <QueryClientProvider client={queryClient}>
        <WorkflowRunLargeJobs run={largeRun()} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', {name: 'Load more jobs'}));
    expect(await screen.findByRole('button', {name: 'Retry'})).toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: 'Retry'}));

    expect(await screen.findByText('deploy')).toBeInTheDocument();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });
});

function largeRun(): WorkflowRunOverview {
  const detail = workflowRunDetail({id: RUN_ID, jobs: []});
  const firstJob = new WorkflowRunOverviewJob({
    id: FIRST_JOB_ID,
    key: 'build',
    name: 'build',
    position: 0,
    dependencies: [],
    status: 'succeeded',
    statusReason: null,
    mode: 'one_shot',
    listenerStatus: 'inactive',
    carriedOver: false,
    executionCount: 1,
    executionStatusCounts: {
      pending: 0,
      running: 0,
      succeeded: 1,
      failed: 0,
      cancelled: 0,
    },
    defaultExecution: null,
  });

  return {
    ...detail,
    jobs: {
      kind: 'large',
      total: 2,
      statusCounts: [{status: 'succeeded', count: 2}],
      firstPage: {items: [firstJob], nextCursor: 'jobs-page-2', total: 2},
    },
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}
