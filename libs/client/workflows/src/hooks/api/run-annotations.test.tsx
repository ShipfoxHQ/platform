import type {
  WorkflowRunAnnotationItemDto,
  WorkflowRunJobExplanationDto,
} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, cleanup, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {runAnnotationsQueryOptions, useRunAnnotationsQuery} from './run-annotations.js';
import {
  runJobExplanationsQueryOptions,
  useRunJobExplanationsQuery,
} from './run-job-explanations.js';
import {
  WORKFLOW_RESOURCE_ACTIVE_POLL_MS,
  WORKFLOW_RESOURCE_ERROR_POLL_MS,
} from './workflow-resource-query.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '44444444-4444-4444-8444-00000000000b';
const EXECUTION_ID = '77777777-7777-4777-8777-00000000000b';
const STEP_ID = '55555555-5555-4555-8555-00000000000b';
const STEP_ATTEMPT_ID = '66666666-6666-4666-8666-00000000000b';

describe('run annotation resource hooks', () => {
  afterEach(() => {
    cleanup();
    configureApiClient({baseUrl: '', fetchImpl: undefined});
  });

  test('loads and independently pages enriched annotations and job explanations', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.pathname.endsWith('/job-explanations')) {
        return Promise.resolve(jsonResponse({items: [jobExplanation()], next_cursor: null}));
      }
      const secondPage = url.searchParams.get('cursor') === 'annotation-page-2';
      return Promise.resolve(
        jsonResponse({
          items: secondPage ? [annotationItem('second')] : [annotationItem('first')],
          next_cursor: secondPage ? null : 'annotation-page-2',
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderWithQueryClient(() => ({
      annotations: useRunAnnotationsQuery({workflowRunId: RUN_ID, runAttempt: 2}),
      explanations: useRunJobExplanationsQuery({workflowRunId: RUN_ID, runAttempt: 2}),
    }));

    await waitFor(() => {
      expect(result.current.annotations.entries).toHaveLength(1);
      expect(result.current.explanations.explanations).toHaveLength(1);
    });
    expect(requestUrls(fetchImpl)).toEqual([
      `https://api.example.test/workflows/runs/${RUN_ID}/annotations?attempt=2&limit=100`,
      `https://api.example.test/workflows/runs/${RUN_ID}/job-explanations?attempt=2&limit=100`,
    ]);
    expect(result.current.annotations.summary).toMatchObject({total: 1, truncated: true});
    expect(result.current.explanations.explanations?.[0]).toMatchObject({
      jobName: 'Deploy',
      statusReason: 'condition_rejected',
    });

    await act(() => result.current.annotations.query.fetchNextPage());

    await waitFor(() =>
      expect(result.current.annotations.entries?.map(({annotation}) => annotation.context)).toEqual(
        ['first', 'second'],
      ),
    );
    expect(requestUrls(fetchImpl).at(-1)).toBe(
      `https://api.example.test/workflows/runs/${RUN_ID}/annotations?attempt=2&limit=100&cursor=annotation-page-2`,
    );
    expect(result.current.annotations.summary).toMatchObject({total: 2, truncated: false});
  });

  test.each([
    ['annotations', runAnnotationsQueryOptions],
    ['job explanations', runJobExplanationsQueryOptions],
  ] as const)('keeps a recoverable first-page polling policy for %s', (_name, optionsFor) => {
    const options = optionsFor({workflowRunId: RUN_ID, runAttempt: 2, live: true});

    expect(refetchInterval(options, 1, null)).toBe(WORKFLOW_RESOURCE_ACTIVE_POLL_MS);
    expect(refetchInterval(options, 1, new Error('Unavailable'))).toBe(
      WORKFLOW_RESOURCE_ERROR_POLL_MS,
    );
    expect(refetchInterval(options, 2, null)).toBe(false);
    expect(refetchOnWindowFocus(options, 1)).toBe(true);
    expect(refetchOnWindowFocus(options, 2)).toBe(false);
  });

  test.each([
    ['annotations', runAnnotationsQueryOptions],
    ['job explanations', runJobExplanationsQueryOptions],
  ] as const)('settles terminal %s resources', (_name, optionsFor) => {
    const options = optionsFor({workflowRunId: RUN_ID, runAttempt: 2, live: false});

    expect(options.staleTime).toBe(Infinity);
    expect(refetchInterval(options, 1, null)).toBe(false);
    expect(refetchOnWindowFocus(options, 1)).toBe(false);
  });

  test('stops automatic aggregation when the API repeats a cursor', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      const repeatedPage = url.searchParams.get('cursor') === 'repeat-cursor';
      return Promise.resolve(
        jsonResponse({
          items: [annotationItem(repeatedPage ? 'second' : 'first')],
          next_cursor: 'repeat-cursor',
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderWithQueryClient(() =>
      useRunAnnotationsQuery({
        workflowRunId: RUN_ID,
        runAttempt: 2,
        loadAllPages: true,
      }),
    );

    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(result.current.query.hasNextPage).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.current.entries).toHaveLength(2);
    expect(result.current.summary).toMatchObject({total: 2, truncated: true});
  });
});

function refetchInterval(
  options: {refetchInterval?: unknown},
  pageCount: number,
  error: Error | null,
) {
  if (typeof options.refetchInterval !== 'function') return options.refetchInterval;
  return options.refetchInterval({
    state: {data: {pages: Array.from({length: pageCount}, () => ({}))}, error},
  } as never);
}

function refetchOnWindowFocus(options: {refetchOnWindowFocus?: unknown}, pageCount: number) {
  if (typeof options.refetchOnWindowFocus !== 'function') return options.refetchOnWindowFocus;
  return options.refetchOnWindowFocus({
    state: {data: {pages: Array.from({length: pageCount}, () => ({}))}},
  } as never);
}

function renderWithQueryClient<T>(callback: () => T) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(callback, {wrapper});
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input);
  return input instanceof URL ? input : new URL(input.url);
}

function requestUrls(fetchImpl: ReturnType<typeof vi.fn>): string[] {
  return fetchImpl.mock.calls.map(([input]) => requestUrl(input as RequestInfo | URL).href);
}

function annotationItem(context: string): WorkflowRunAnnotationItemDto {
  return {
    annotation: {
      id:
        context === 'first'
          ? 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'
          : 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
      job_id: JOB_ID,
      job_execution_id: EXECUTION_ID,
      origin_step_id: STEP_ID,
      origin_step_attempt: 1,
      context,
      style: 'info',
      sequence: context === 'first' ? 1 : 2,
      body: 'Body',
    },
    origin: {
      job_id: JOB_ID,
      job_label: 'Build',
      job_position: 0,
      job_execution_id: EXECUTION_ID,
      execution_sequence: 1,
      execution_label: null,
      step_id: STEP_ID,
      step_label: 'Compile',
      step_attempt_id: STEP_ATTEMPT_ID,
      step_attempt: 1,
    },
  };
}

function jobExplanation(): WorkflowRunJobExplanationDto {
  return {
    job_id: JOB_ID,
    job_label: 'Deploy',
    job_position: 1,
    status: 'skipped',
    status_reason: 'condition_rejected',
    evaluation_trace: null,
  };
}
