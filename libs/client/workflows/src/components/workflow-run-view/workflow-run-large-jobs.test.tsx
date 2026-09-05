import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {type WorkflowRunOverview, WorkflowRunOverviewJob} from '#core/workflow-run.js';
import {workflowRunOverview} from '#test/fixtures/workflow-run.js';
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

  test('does not attach usage from another attempt when a job has no selected execution', async () => {
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    const {container} = render(
      <QueryClientProvider client={queryClient}>
        <WorkflowRunLargeJobs
          run={largeRun()}
          usage={{
            jobExecutions: [
              {
                jobId: FIRST_JOB_ID,
                jobExecutionId: '55555555-5555-4555-8555-555555555555',
                workflowRunId: RUN_ID,
                workflowRunAttemptId: '66666666-6666-4666-8666-666666666666',
                workspaceId: '77777777-7777-4777-8777-777777777777',
                projectId: '88888888-8888-4888-8888-888888888888',
                definitionId: null,
                jobKey: 'build',
                runNumber: 42,
                requestedLabels: null,
                runnerLabels: null,
                templateKey: null,
                provisionerId: null,
                provisionerScope: null,
                providerKind: null,
                launchKind: null,
                runnerClass: null,
                runnerArch: null,
                runnerCpu: null,
                managed: null,
                queuedAt: null,
                startedAt: null,
                finishedAt: null,
                leaseExpiredAt: null,
                status: 'succeeded',
                statusReason: null,
                cancellationReason: null,
                durationSeconds: 60,
                state: 'terminated',
                recordedAt: null,
              },
            ],
            inferenceSegments: [],
          }}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('build')).toBeInTheDocument();
    expect(container.querySelector('[data-usage-job-cells]')).not.toBeInTheDocument();
  });
});

function largeRun(): WorkflowRunOverview {
  const detail = workflowRunOverview({id: RUN_ID, status: 'succeeded'});
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
