import type {
  WorkflowExecutionStepsResponseDto,
  WorkflowJobDetailDto,
  WorkflowJobExecutionSummariesResponseDto,
  WorkflowStepAttemptSummariesResponseDto,
} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, cleanup, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {
  workflowJobDetailResponseDto,
  workflowJobDto,
  workflowJobExecutionDto,
  workflowRunDetailDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {jsonResponse} from '#test/pages.js';
import {
  invalidateWorkflowJobResources,
  useWorkflowExecutionStepsInfiniteQuery,
  useWorkflowJobExecutionsInfiniteQuery,
  useWorkflowStepAttemptsInfiniteQuery,
  workflowJobDetailQueryOptions,
} from './workflow-job-detail.js';
import {toWorkflowJobDetail} from './workflow-job-detail-mapper.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';
const JOB_ID = '88888888-8888-4888-8888-888888888888';
const EXECUTION_ID = '77777777-7777-4777-8777-777777777777';
const STEP_ID = '99999999-9999-4999-8999-999999999999';
const ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECOND_EXECUTION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SECOND_STEP_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SECOND_ATTEMPT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function renderWithQueryClient<T>(callback: () => T) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {queryClient, ...renderHook(callback, {wrapper})};
}

describe('selected-job API hooks', () => {
  afterEach(() => {
    cleanup();
    configureApiClient({baseUrl: '', fetchImpl: undefined});
  });

  test('fetches a bounded selected-job detail and preserves the request signal', async () => {
    const response = selectedJobDetailResponseDto();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(response));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const queryClient = new QueryClient();
    const detail = await queryClient.fetchQuery(
      workflowJobDetailQueryOptions({jobId: JOB_ID, executionId: EXECUTION_ID}),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = fetchImpl.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    if (!(request instanceof Request)) throw new Error('Expected a Request');
    expect(request.url).toBe(
      `https://api.example.test/workflows/runs/jobs/${JOB_ID}?execution_id=${EXECUTION_ID}`,
    );
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(detail).toMatchObject({
      workflowRunId: RUN_ID,
      workflowRunAttempt: 1,
      job: {id: JOB_ID, key: 'release'},
      selectedExecution: {
        id: EXECUTION_ID,
        jobId: JOB_ID,
        steps: {items: [{id: STEP_ID, jobExecutionId: EXECUTION_ID}]},
      },
    });
    expect(detail.selectedExecution).not.toHaveProperty('runner');
    const mappedDetail = toWorkflowJobDetail(response);
    expect(mappedDetail.selectedExecution?.steps.items[0]?.attempts.items[0]?.gateResult).toEqual({
      kind: 'unknown',
      data: {},
    });
  });

  test('uses bounded cursor resources for execution, step, and attempt history', async () => {
    const requests: URL[] = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(requestUrl(input));
      requests.push(url);

      if (url.pathname === `/workflows/runs/jobs/${JOB_ID}/executions`) {
        return Promise.resolve(jsonResponse(executionPage(url.searchParams.get('cursor'))));
      }
      if (url.pathname === `/workflows/runs/jobs/${JOB_ID}/executions/${EXECUTION_ID}/steps`) {
        return Promise.resolve(jsonResponse(stepPage(url.searchParams.get('cursor'))));
      }
      if (url.pathname === `/workflows/runs/steps/${STEP_ID}/attempts`) {
        return Promise.resolve(jsonResponse(attemptPage(url.searchParams.get('cursor'))));
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderWithQueryClient(() => ({
      executions: useWorkflowJobExecutionsInfiniteQuery({jobId: JOB_ID}),
      steps: useWorkflowExecutionStepsInfiniteQuery({
        jobId: JOB_ID,
        executionId: EXECUTION_ID,
      }),
      attempts: useWorkflowStepAttemptsInfiniteQuery({stepId: STEP_ID}),
    }));

    await waitFor(() => {
      expect(result.current.executions.data?.pages[0]?.items).toHaveLength(1);
      expect(result.current.steps.data?.pages[0]?.items).toHaveLength(1);
      expect(result.current.attempts.data?.pages[0]?.items).toHaveLength(1);
    });

    await act(async () => {
      await Promise.all([
        result.current.executions.fetchNextPage(),
        result.current.steps.fetchNextPage(),
        result.current.attempts.fetchNextPage(),
      ]);
    });

    await waitFor(() => {
      expect(result.current.executions.data?.pages).toHaveLength(2);
      expect(result.current.steps.data?.pages).toHaveLength(2);
      expect(result.current.attempts.data?.pages).toHaveLength(2);
    });
    expect(requestQuery(requests, `/workflows/runs/jobs/${JOB_ID}/executions`)).toEqual([
      'limit=25',
      'limit=25&cursor=execution-cursor',
    ]);
    expect(
      requestQuery(requests, `/workflows/runs/jobs/${JOB_ID}/executions/${EXECUTION_ID}/steps`),
    ).toEqual(['limit=100', 'limit=100&cursor=step-cursor']);
    expect(requestQuery(requests, `/workflows/runs/steps/${STEP_ID}/attempts`)).toEqual([
      'limit=25',
      'limit=25&cursor=attempt-cursor',
    ]);
    expect(result.current.attempts.data?.pages[0]?.items[0]?.jobExecutionId).toBeUndefined();
  });

  test('invalidates only the selected job detail and its history', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    await invalidateWorkflowJobResources(queryClient, {
      jobId: JOB_ID,
      executionId: EXECUTION_ID,
    });

    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['workflow-jobs', 'detail', JOB_ID, EXECUTION_ID],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['workflow-jobs', 'executions', JOB_ID],
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith(
      expect.objectContaining({queryKey: expect.arrayContaining(['workflow-runs'])}),
    );
  });
});

function selectedJobDetailResponseDto(): WorkflowJobDetailDto {
  const step = workflowStepDto({
    id: STEP_ID,
    key: 'tests',
    name: 'tests',
    status: 'succeeded',
    attempts: [
      workflowStepAttemptDto({
        id: ATTEMPT_ID,
        step_id: STEP_ID,
        attempt: 1,
        status: 'succeeded',
      }),
    ],
  });
  const execution = workflowJobExecutionDto({
    id: EXECUTION_ID,
    job_id: JOB_ID,
    sequence: 2,
    name: 'release',
    status: 'succeeded',
    steps: [step],
  });
  return workflowJobDetailResponseDto({
    detail: workflowRunDetailDto({
      id: RUN_ID,
      run_attempt: {...workflowRunDetailDto().run_attempt, workflow_run_id: RUN_ID},
      jobs: [
        workflowJobDto({
          id: JOB_ID,
          key: 'release',
          name: 'release',
          status: 'succeeded',
          job_executions: [execution],
        }),
      ],
    }),
    jobId: JOB_ID,
    executionId: EXECUTION_ID,
  });
}

function executionPage(cursor: string | null): WorkflowJobExecutionSummariesResponseDto {
  return {
    items: [executionSummaryDto(cursor ? SECOND_EXECUTION_ID : EXECUTION_ID, cursor ? 1 : 2)],
    next_cursor: cursor ? null : 'execution-cursor',
    total: 2,
  };
}

function stepPage(cursor: string | null): WorkflowExecutionStepsResponseDto {
  return {
    items: [stepSummaryDto(cursor ? SECOND_STEP_ID : STEP_ID)],
    next_cursor: cursor ? null : 'step-cursor',
    total: 2,
  };
}

function attemptPage(cursor: string | null): WorkflowStepAttemptSummariesResponseDto {
  return {
    items: [
      {
        id: cursor ? SECOND_ATTEMPT_ID : ATTEMPT_ID,
        attempt: cursor ? 2 : 1,
        execution_order: cursor ? 2 : 1,
        status: 'succeeded',
        exit_code: 0,
        started_at: '2026-06-21T12:00:00.000Z',
        finished_at: '2026-06-21T12:01:00.000Z',
        error: null,
        gate_result: {kind: 'unknown'},
      },
    ],
    next_cursor: cursor ? null : 'attempt-cursor',
    total: 2,
  };
}

function executionSummaryDto(id: string, sequence: number) {
  return {
    id,
    sequence,
    name: 'release',
    status: 'succeeded' as const,
    display_status: 'succeeded' as const,
    status_reason: null,
    status_reason_message: null,
    queued_at: '2026-06-21T12:00:00.000Z',
    started_at: '2026-06-21T12:00:05.000Z',
    finished_at: '2026-06-21T12:01:00.000Z',
    timed_out_at: null,
    updated_at: '2026-06-21T12:01:00.000Z',
  };
}

function stepSummaryDto(id: string) {
  return {
    id,
    key: 'tests',
    name: 'tests',
    type: 'run' as const,
    position: 0,
    status: 'succeeded' as const,
    status_reason: null,
    source_location: null,
    current_attempt: 1,
    error: null,
    attempts: {
      items: [],
      next_cursor: null,
      total: 0,
    },
  };
}

function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input);
}

function requestQuery(requests: readonly URL[], pathname: string): string[] {
  return requests
    .filter((request) => request.pathname === pathname)
    .map((request) => request.search.slice(1));
}
