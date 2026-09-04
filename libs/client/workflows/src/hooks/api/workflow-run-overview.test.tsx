import type {
  WorkflowRunJobListSummaryDto,
  WorkflowRunJobOverviewDto,
  WorkflowRunOverviewResponseDto,
  WorkflowRunSelectionResponseDto,
  WorkflowRunSourceResponseDto,
} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, cleanup, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {toWorkflowRunOverview} from './workflow-run-mapper.js';
import {
  useWorkflowRunLineageHeadQuery,
  useWorkflowRunOverviewJobsInfiniteQuery,
  useWorkflowRunOverviewQuery,
  useWorkflowRunSourceQuery,
  WORKFLOW_RUN_LINEAGE_HEAD_STALE_TIME_MS,
  WORKFLOW_RUN_OVERVIEW_ACTIVE_POLL_MS,
  workflowRunLineageHeadQueryOptions,
  workflowRunOverviewJobsInfiniteQueryOptions,
  workflowRunOverviewQueryOptions,
} from './workflow-run-overview.js';
import {
  useWorkflowRunSelectionQuery,
  workflowRunSelectionQueryOptions,
} from './workflow-run-selection.js';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const DEFINITION_ID = '33333333-3333-4333-8333-333333333333';
const RUN_ID = '44444444-4444-4444-8444-444444444444';
const ATTEMPT_ID = '55555555-5555-4555-8555-555555555555';
const JOB_ID = '66666666-6666-4666-8666-666666666666';
const SECOND_JOB_ID = '77777777-7777-4777-8777-777777777777';
const EXECUTION_ID = '88888888-8888-4888-8888-888888888888';
const STEP_ID = '99999999-9999-4999-8999-999999999999';
const STEP_ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const CREATED_AT = '2026-06-21T12:00:00.000Z';
const UPDATED_AT = '2026-06-21T12:01:00.000Z';
const STARTED_AT = '2026-06-21T12:00:01.000Z';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

function renderWithQueryClient<T>(callback: () => T) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {queryClient, wrapper, ...renderHook(callback, {wrapper})};
}

describe('workflow run bounded overview API hooks', () => {
  afterEach(() => {
    cleanup();
    configureApiClient({baseUrl: '', fetchImpl: undefined});
  });

  test('fetches the lineage head and complete overview as separate bounded reads', async () => {
    const overview = workflowRunOverviewResponseDto({
      attempt: {attempt: 2, status: 'running'},
      jobs: {
        kind: 'complete',
        total: 1,
        items: [workflowRunJobOverviewDto()],
      },
    });
    const head = {
      current_attempt: 2,
      latest_attempt: 3,
      current_status: 'running',
      updated_at: UPDATED_AT,
    };
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(requestInputUrl(input)).pathname;
      if (path.endsWith('/head')) return Promise.resolve(jsonResponse(head));
      if (path.endsWith('/overview')) return Promise.resolve(jsonResponse(overview));
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderWithQueryClient(() => ({
      head: useWorkflowRunLineageHeadQuery({workflowRunId: RUN_ID}),
      overview: useWorkflowRunOverviewQuery({workflowRunId: RUN_ID, runAttempt: 2}),
    }));

    await waitFor(() => {
      expect(result.current.head.data?.latestAttempt).toBe(3);
      expect(result.current.overview.data?.jobs.kind).toBe('complete');
    });

    expect(requestUrls(fetchImpl)).toEqual([
      `https://api.example.test/workflows/runs/${RUN_ID}/head`,
      `https://api.example.test/workflows/runs/${RUN_ID}/overview?attempt=2`,
    ]);
    const job =
      result.current.overview.data?.jobs.kind === 'complete'
        ? result.current.overview.data.jobs.items[0]
        : undefined;
    expect(job).toMatchObject({
      id: JOB_ID,
      displayName: 'build',
      executionCount: 2,
      executionCountVisible: true,
      displayStatus: 'running',
      defaultExecution: {id: EXECUTION_ID, displayStatus: 'running'},
    });
    expect(job?.displayDuration).toEqual({state: 'live', fromIso: STARTED_AT, kind: 'run'});
  });

  test('does not show an execution count for an idle listening job', () => {
    const overview = toWorkflowRunOverview(
      workflowRunOverviewResponseDto({
        jobs: {
          kind: 'complete',
          total: 1,
          items: [
            workflowRunJobOverviewDto({
              mode: 'listening',
              listener_status: 'listening',
              execution_count: 0,
            }),
          ],
        },
      }),
    );

    if (overview.jobs.kind !== 'complete') throw new Error('Expected a complete overview');
    expect(overview.jobs.items[0]?.executionCountVisible).toBe(false);
  });

  test('keeps large overviews list-only and paginates their bounded job summaries', async () => {
    const overview = workflowRunOverviewResponseDto({
      attempt: {attempt: 4, status: 'succeeded'},
      jobs: {
        kind: 'large',
        total: 101,
        status_counts: [{status: 'succeeded', count: 101}],
        first_page: {
          items: [workflowRunJobListSummaryDto()],
          next_cursor: 'jobs-cursor-1',
          total: 101,
        },
      },
    });
    const secondPage = {
      items: [workflowRunJobListSummaryDto({id: SECOND_JOB_ID, key: 'deploy', name: 'deploy'})],
      next_cursor: null,
      total: 101,
    };
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(requestInputUrl(input));
      if (url.pathname.endsWith('/overview')) return Promise.resolve(jsonResponse(overview));
      if (url.pathname.endsWith('/jobs')) return Promise.resolve(jsonResponse(secondPage));
      return Promise.reject(new Error(`Unexpected request: ${url.pathname}`));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result: overviewResult, wrapper} = renderWithQueryClient(() =>
      useWorkflowRunOverviewQuery({workflowRunId: RUN_ID, runAttempt: 4}),
    );
    await waitFor(() => expect(overviewResult.current.data?.jobs.kind).toBe('large'));

    const largeJobs = overviewResult.current.data?.jobs;
    if (largeJobs?.kind !== 'large') throw new Error('Expected a large overview');
    const {result: jobsResult} = renderHook(
      () =>
        useWorkflowRunOverviewJobsInfiniteQuery({
          workflowRunId: RUN_ID,
          runAttempt: 4,
          initialPage: largeJobs.firstPage,
        }),
      {wrapper},
    );

    expect(jobsResult.current.data?.pages[0]?.items[0]).toMatchObject({id: JOB_ID});
    expect(jobsResult.current.hasNextPage).toBe(true);
    await act(async () => {
      await jobsResult.current.fetchNextPage();
    });

    await waitFor(() => expect(jobsResult.current.data?.pages).toHaveLength(2));
    expect(requestUrls(fetchImpl)).toEqual([
      `https://api.example.test/workflows/runs/${RUN_ID}/overview?attempt=4`,
      `https://api.example.test/workflows/runs/${RUN_ID}/jobs?attempt=4&limit=100&cursor=jobs-cursor-1`,
    ]);
    expect(jobsResult.current.data?.pages[1]?.items[0]).toMatchObject({
      id: SECOND_JOB_ID,
      displayName: 'deploy',
      dependencies: [],
    });
  });

  test('does not bridge an opaque job cursor to a repeated page', async () => {
    const overview = workflowRunOverviewResponseDto({
      attempt: {attempt: 4, status: 'succeeded'},
      jobs: {
        kind: 'large',
        total: 201,
        status_counts: [{status: 'succeeded', count: 201}],
        first_page: {
          items: [workflowRunJobListSummaryDto()],
          next_cursor: 'server-cursor-2',
          total: 201,
        },
      },
    });
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(requestInputUrl(input));
      if (url.pathname.endsWith('/overview')) return Promise.resolve(jsonResponse(overview));
      if (url.pathname.endsWith('/jobs')) {
        return Promise.resolve(jsonResponse({code: 'not_found'}, {status: 404}));
      }
      return Promise.reject(new Error(`Unexpected request: ${url.pathname}`));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result: overviewResult, wrapper} = renderWithQueryClient(() =>
      useWorkflowRunOverviewQuery({workflowRunId: RUN_ID, runAttempt: 4}),
    );
    await waitFor(() => expect(overviewResult.current.data?.jobs.kind).toBe('large'));

    const largeJobs = overviewResult.current.data?.jobs;
    if (largeJobs?.kind !== 'large') throw new Error('Expected a large overview');
    const {result: jobsResult} = renderHook(
      () =>
        useWorkflowRunOverviewJobsInfiniteQuery({
          workflowRunId: RUN_ID,
          runAttempt: 4,
          initialPage: largeJobs.firstPage,
        }),
      {wrapper},
    );

    await act(async () => {
      await jobsResult.current.fetchNextPage();
    });

    await waitFor(() =>
      expect(requestUrls(fetchImpl)).toContain(
        `https://api.example.test/workflows/runs/${RUN_ID}/jobs?attempt=4&limit=100&cursor=server-cursor-2`,
      ),
    );
    expect(jobsResult.current.data?.pages).toHaveLength(1);
    expect(requestUrls(fetchImpl)).toEqual([
      `https://api.example.test/workflows/runs/${RUN_ID}/overview?attempt=4`,
      `https://api.example.test/workflows/runs/${RUN_ID}/jobs?attempt=4&limit=100&cursor=server-cursor-2`,
    ]);
  });

  test('does not poll or refetch a terminal overview and keeps the head seed stale', () => {
    const options = workflowRunOverviewQueryOptions({workflowRunId: RUN_ID, runAttempt: 1});
    if (
      typeof options.staleTime !== 'function' ||
      typeof options.refetchOnWindowFocus !== 'function' ||
      typeof options.refetchInterval !== 'function'
    ) {
      throw new Error('Expected status-aware overview query options');
    }
    const terminalQuery = {state: {data: {runAttempt: {status: 'succeeded'}}}} as never;
    const activeQuery = {state: {data: {runAttempt: {status: 'running'}}}} as never;
    const failedQuery = {state: {data: undefined, error: new Error('unavailable')}} as never;

    expect(options.staleTime(terminalQuery)).toBe(Infinity);
    expect(options.staleTime(activeQuery)).toBe(2_000);
    expect(options.refetchOnWindowFocus(terminalQuery)).toBe(false);
    expect(options.refetchOnWindowFocus(activeQuery)).toBe(true);
    expect(options.refetchInterval(terminalQuery)).toBe(false);
    expect(options.refetchInterval(activeQuery)).toBe(WORKFLOW_RUN_OVERVIEW_ACTIVE_POLL_MS);
    expect(options.refetchInterval(failedQuery)).toBe(false);
    expect(options.refetchIntervalInBackground).toBe(false);

    const headOptions = workflowRunLineageHeadQueryOptions({
      workflowRunId: RUN_ID,
      initialData: {
        currentAttempt: 1,
        latestAttempt: 1,
        currentStatus: 'running',
        updatedAt: UPDATED_AT,
      },
    });
    expect(headOptions.initialDataUpdatedAt).toBe(0);
    expect(headOptions.staleTime).toBe(WORKFLOW_RUN_LINEAGE_HEAD_STALE_TIME_MS);
    expect(headOptions.refetchOnMount).toBe('always');

    const jobsOptions = workflowRunOverviewJobsInfiniteQueryOptions({
      workflowRunId: RUN_ID,
      runAttempt: 1,
      polling: true,
    });
    if (typeof jobsOptions.refetchInterval !== 'function') {
      throw new Error('Expected status-aware large-job query options');
    }
    const firstPageQuery = {state: {data: {pages: [{}]}}} as never;
    const pagedQuery = {state: {data: {pages: [{}, {}]}}} as never;
    expect(jobsOptions.refetchInterval(firstPageQuery)).toBe(WORKFLOW_RUN_OVERVIEW_ACTIVE_POLL_MS);
    expect(jobsOptions.refetchInterval(pagedQuery)).toBe(false);
    const inactiveJobsOptions = workflowRunOverviewJobsInfiniteQueryOptions({
      workflowRunId: RUN_ID,
      runAttempt: 1,
      polling: false,
    });
    if (typeof inactiveJobsOptions.refetchInterval !== 'function') {
      throw new Error('Expected status-aware large-job query options');
    }
    expect(inactiveJobsOptions.refetchInterval(firstPageQuery)).toBe(false);
  });

  test('fetches the narrow source projection', async () => {
    const source: WorkflowRunSourceResponseDto = {
      kind: 'available',
      workflow_run_id: RUN_ID,
      workflow_run_attempt: 2,
      source_snapshot: {format: 'yaml', content: 'jobs: {}'},
    };
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(source)));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderWithQueryClient(() =>
      useWorkflowRunSourceQuery({workflowRunId: RUN_ID, enabled: true}),
    );

    await waitFor(() => expect(result.current.data?.kind).toBe('available'));
    expect(firstRequest(fetchImpl).url).toBe(
      `https://api.example.test/workflows/runs/${RUN_ID}/source`,
    );
    expect(result.current.data).toMatchObject({
      workflowRunId: RUN_ID,
      workflowRunAttempt: 2,
      sourceSnapshot: {format: 'yaml', content: 'jobs: {}'},
    });
  });

  test('does not fall back to another route when source is unavailable', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(requestInputUrl(input));
      if (url.pathname.endsWith('/source')) {
        return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
      }
      return Promise.reject(new Error(`Unexpected request: ${url.pathname}`));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderWithQueryClient(() =>
      useWorkflowRunSourceQuery({workflowRunId: RUN_ID, enabled: true}),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(requestUrls(fetchImpl)).toEqual([
      `https://api.example.test/workflows/runs/${RUN_ID}/source`,
    ]);
    expect(result.current.data).toBeUndefined();
  });

  test('does not fall back to another route after an operational overview failure', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({code: 'internal'}, {status: 500})));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderWithQueryClient(() =>
      useWorkflowRunOverviewQuery({workflowRunId: RUN_ID, runAttempt: 2}),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('resolves a nested selection through the UUID-scoped selection endpoint', async () => {
    const selection: WorkflowRunSelectionResponseDto = {
      workflow_run_id: RUN_ID,
      workflow_run_attempt: 3,
      job_id: JOB_ID,
      job_execution_id: EXECUTION_ID,
      step_id: STEP_ID,
      step_attempt_id: STEP_ATTEMPT_ID,
      step_attempt: 2,
      source_location: {start_line: 12, end_line: 18},
    };
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(selection)));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderWithQueryClient(() =>
      useWorkflowRunSelectionQuery({
        workflowRunId: RUN_ID,
        runAttempt: 3,
        jobId: JOB_ID,
        jobExecutionId: EXECUTION_ID,
        stepId: STEP_ID,
        stepAttemptId: STEP_ATTEMPT_ID,
      }),
    );

    await waitFor(() => expect(result.current.data?.workflowRunAttempt).toBe(3));
    expect(firstRequest(fetchImpl).url).toBe(
      `https://api.example.test/workflows/runs/${RUN_ID}/selection?attempt=3&job_id=${JOB_ID}&job_execution_id=${EXECUTION_ID}&step_id=${STEP_ID}&step_attempt_id=${STEP_ATTEMPT_ID}`,
    );
    expect(result.current.data).toMatchObject({
      workflowRunId: RUN_ID,
      jobId: JOB_ID,
      jobExecutionId: EXECUTION_ID,
      stepAttempt: 2,
      sourceLocation: {startLine: 12, endLine: 18},
    });
  });

  test('refetches when a cached selection belongs to another requested attempt', async () => {
    const selectionForAttempt = (attempt: number): WorkflowRunSelectionResponseDto => ({
      workflow_run_id: RUN_ID,
      workflow_run_attempt: attempt,
      job_id: JOB_ID,
      job_execution_id: EXECUTION_ID,
      step_id: STEP_ID,
      step_attempt_id: STEP_ATTEMPT_ID,
      step_attempt: attempt,
      source_location: null,
    });
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(requestInputUrl(input));
      const attempt = Number(url.searchParams.get('attempt'));
      return Promise.resolve(jsonResponse(selectionForAttempt(attempt)));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    const wrapper = ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const {result, rerender} = renderHook(
      ({runAttempt}: {runAttempt: number}) =>
        useWorkflowRunSelectionQuery({
          workflowRunId: RUN_ID,
          runAttempt,
          jobId: JOB_ID,
          jobExecutionId: EXECUTION_ID,
          stepId: STEP_ID,
          stepAttemptId: STEP_ATTEMPT_ID,
        }),
      {initialProps: {runAttempt: 1}, wrapper},
    );

    await waitFor(() => expect(result.current.data?.workflowRunAttempt).toBe(1));

    rerender({runAttempt: 2});

    await waitFor(() => expect(result.current.data?.workflowRunAttempt).toBe(2));
    expect(requestUrls(fetchImpl)).toEqual([
      `https://api.example.test/workflows/runs/${RUN_ID}/selection?attempt=1&job_id=${JOB_ID}&job_execution_id=${EXECUTION_ID}&step_id=${STEP_ID}&step_attempt_id=${STEP_ATTEMPT_ID}`,
      `https://api.example.test/workflows/runs/${RUN_ID}/selection?attempt=2&job_id=${JOB_ID}&job_execution_id=${EXECUTION_ID}&step_id=${STEP_ID}&step_attempt_id=${STEP_ATTEMPT_ID}`,
    ]);
  });

  test('allows a later attempt to refetch after an earlier attempt fails', async () => {
    const selectionForAttempt = (attempt: number): WorkflowRunSelectionResponseDto => ({
      workflow_run_id: RUN_ID,
      workflow_run_attempt: attempt,
      job_id: JOB_ID,
      job_execution_id: EXECUTION_ID,
      step_id: STEP_ID,
      step_attempt_id: STEP_ATTEMPT_ID,
      step_attempt: attempt,
      source_location: null,
    });
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(requestInputUrl(input));
      const attempt = Number(url.searchParams.get('attempt'));
      return attempt === 2
        ? Promise.resolve(jsonResponse({code: 'unavailable'}, {status: 500}))
        : Promise.resolve(jsonResponse(selectionForAttempt(attempt)));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    const wrapper = ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const {result, rerender} = renderHook(
      ({runAttempt}: {runAttempt: number}) =>
        useWorkflowRunSelectionQuery({
          workflowRunId: RUN_ID,
          runAttempt,
          jobId: JOB_ID,
          jobExecutionId: EXECUTION_ID,
          stepId: STEP_ID,
          stepAttemptId: STEP_ATTEMPT_ID,
        }),
      {initialProps: {runAttempt: 1}, wrapper},
    );

    await waitFor(() => expect(result.current.data?.workflowRunAttempt).toBe(1));

    rerender({runAttempt: 2});
    await waitFor(() => expect(result.current.isError).toBe(true));

    rerender({runAttempt: 3});

    await waitFor(() => expect(result.current.data?.workflowRunAttempt).toBe(3));
    expect(requestUrls(fetchImpl)).toEqual([
      `https://api.example.test/workflows/runs/${RUN_ID}/selection?attempt=1&job_id=${JOB_ID}&job_execution_id=${EXECUTION_ID}&step_id=${STEP_ID}&step_attempt_id=${STEP_ATTEMPT_ID}`,
      `https://api.example.test/workflows/runs/${RUN_ID}/selection?attempt=2&job_id=${JOB_ID}&job_execution_id=${EXECUTION_ID}&step_id=${STEP_ID}&step_attempt_id=${STEP_ATTEMPT_ID}`,
      `https://api.example.test/workflows/runs/${RUN_ID}/selection?attempt=3&job_id=${JOB_ID}&job_execution_id=${EXECUTION_ID}&step_id=${STEP_ID}&step_attempt_id=${STEP_ATTEMPT_ID}`,
    ]);
  });

  test('does not put the optional attempt in the selection query key', () => {
    const identity = {stepId: STEP_ID, stepAttemptId: STEP_ATTEMPT_ID};
    const firstAttempt = workflowRunSelectionQueryOptions({
      workflowRunId: RUN_ID,
      runAttempt: 1,
      ...identity,
    });
    const secondAttempt = workflowRunSelectionQueryOptions({
      workflowRunId: RUN_ID,
      runAttempt: 2,
      ...identity,
    });

    expect(firstAttempt.queryKey).toEqual(secondAttempt.queryKey);
    expect(firstAttempt.queryKey).toEqual([
      'workflow-runs',
      'selection',
      RUN_ID,
      null,
      null,
      STEP_ID,
      STEP_ATTEMPT_ID,
    ]);
  });
});

function workflowRunOverviewResponseDto(
  overrides: Omit<Partial<WorkflowRunOverviewResponseDto>, 'attempt'> & {
    attempt?: Partial<WorkflowRunOverviewResponseDto['attempt']>;
  } = {},
): WorkflowRunOverviewResponseDto {
  const {attempt, ...restOverrides} = overrides;
  return {
    run: {
      id: RUN_ID,
      project_id: PROJECT_ID,
      definition_id: DEFINITION_ID,
      number: 7,
      name: 'deploy-web',
      workflow_name: 'deploy-web',
      origin: 'synced',
      dev_source: null,
      trigger_provider: null,
      trigger_source: 'manual',
      trigger_event: 'fire',
      trigger_reference: null,
      created_at: CREATED_AT,
    },
    has_started_job_execution: true,
    jobs: {
      kind: 'complete',
      total: 0,
      items: [],
    },
    ...restOverrides,
    attempt: {...defaultAttempt(), ...attempt},
  };
}

function defaultAttempt() {
  return {
    id: ATTEMPT_ID,
    workflow_run_id: RUN_ID,
    attempt: 1,
    status: 'running' as const,
    created_at: CREATED_AT,
    started_at: STARTED_AT,
    finished_at: null,
    rerun_mode: null,
  };
}

function workflowRunJobOverviewDto(
  overrides: Partial<WorkflowRunJobOverviewDto> = {},
): WorkflowRunJobOverviewDto {
  return {
    id: JOB_ID,
    key: 'build',
    name: 'build',
    position: 0,
    dependencies: [],
    status: 'running',
    status_reason: null,
    mode: 'one_shot',
    listener_status: 'inactive',
    carried_over: false,
    execution_count: 2,
    execution_status_counts: {
      pending: 0,
      running: 1,
      succeeded: 1,
      failed: 0,
      cancelled: 0,
    },
    default_execution: {
      id: EXECUTION_ID,
      sequence: 1,
      name: 'build',
      status: 'running',
      display_status: 'running',
      status_reason: null,
      status_reason_message: null,
      queued_at: CREATED_AT,
      started_at: STARTED_AT,
      finished_at: null,
      timed_out_at: null,
      updated_at: UPDATED_AT,
    },
    ...overrides,
  };
}

function workflowRunJobListSummaryDto(
  overrides: Partial<WorkflowRunJobOverviewDto> = {},
): WorkflowRunJobListSummaryDto {
  const {dependencies: _dependencies, ...summary} = workflowRunJobOverviewDto(overrides);
  return summary;
}

function requestInputUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return String(input);
}

function requestUrls(fetchImpl: ReturnType<typeof vi.fn>): string[] {
  return (fetchImpl.mock.calls as unknown[][]).map(([input]) =>
    requestInputUrl(input as RequestInfo),
  );
}

function firstRequest(fetchImpl: ReturnType<typeof vi.fn>): Request {
  const input = (fetchImpl.mock.calls as unknown[][])[0]?.[0];
  if (!(input instanceof Request)) throw new Error('Expected fetch to receive a Request');
  return input;
}
