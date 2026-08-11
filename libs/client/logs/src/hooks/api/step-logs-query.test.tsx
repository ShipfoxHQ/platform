import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {cleanup, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {STEP_LOG_DRAIN_REFETCH_MS, STEP_LOG_LIVE_REFETCH_MS} from '#core/log-read.js';
import {type UseStepAttemptLogsQueryOptions, useStepAttemptLogsQuery} from './step-logs.js';

const STEP_ID = '11111111-1111-4111-8111-111111111111';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

const outputLine = (data: string, ts = 1): string =>
  `${JSON.stringify({v: 1, ts, type: 'output', stream: 'stdout', data})}\n`;
const inlineBody = ({
  ndjson,
  nextCursor,
  hasMore = false,
  state = 'open',
}: {
  ndjson: string;
  nextCursor: number;
  hasMore?: boolean;
  state?: 'open' | 'closed';
}) => ({
  mode: 'inline',
  ndjson,
  next_cursor: nextCursor,
  has_more: hasMore,
  state,
  truncated: false,
});

const presignedBody = () => ({
  mode: 'presigned',
  url: 'https://storage.example.test/logs/object?sig=1',
  state: 'closed',
  expires_at: '2026-06-23T10:00:00.000Z',
  total_bytes: 128,
  truncated: false,
});

function renderStepLogsHook(
  params: {stepId: string | undefined; attempt: number | undefined} = {
    stepId: STEP_ID,
    attempt: 1,
  },
  options: UseStepAttemptLogsQueryOptions = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return renderHook(() => useStepAttemptLogsQuery(params.stepId, params.attempt, options), {
    wrapper,
  });
}

function requestsFrom(fetchImpl: ReturnType<typeof vi.fn>): Request[] {
  return fetchImpl.mock.calls.map((call) => call[0] as Request);
}

describe('useStepAttemptLogsQuery', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    configureApiClient({baseUrl: '', fetchImpl: undefined});
  });

  test('does not fetch until step id and attempt are available', () => {
    const fetchImpl = vi.fn(async () => jsonResponse(inlineBody({ndjson: '', nextCursor: 0})));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderStepLogsHook({stepId: undefined, attempt: undefined});

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('uses the cached cursor on the next fetch and appends live records', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(inlineBody({ndjson: outputLine('alpha\n', 1), nextCursor: 5})),
      )
      .mockResolvedValueOnce(
        jsonResponse(inlineBody({ndjson: outputLine('beta\n', 2), nextCursor: 6})),
      );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderStepLogsHook();
    await waitFor(() => expect(result.current.data?.records).toHaveLength(1));
    await result.current.refetch();

    await waitFor(() => expect(result.current.data?.records).toHaveLength(2));
    const urls = requestsFrom(fetchImpl).map((request) => new URL(request.url));
    expect(urls.map((url) => url.searchParams.get('cursor'))).toEqual(['0', '5']);
    expect(result.current.data?.records.map((record) => record.type)).toEqual(['output', 'output']);
  });

  test('fetches and parses compacted presigned logs into the same record state', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(presignedBody()));
    const objectFetch = vi.fn(async () => new Response(outputLine('cold\n', 3), {status: 200}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    vi.stubGlobal('fetch', objectFetch);

    const {result} = renderStepLogsHook();

    await waitFor(() => expect(result.current.data?.source).toBe('presigned'));
    expect(objectFetch).toHaveBeenCalledWith('https://storage.example.test/logs/object?sig=1', {
      signal: expect.any(AbortSignal),
    });
    expect(result.current.data?.records).toMatchObject([{type: 'output', data: 'cold\n'}]);
    expect(result.current.data?.state).toBe('compacted');
    expect(result.current.data?.complete).toBe(true);
    expect(result.current.data?.totalBytes).toBe(128);
  });

  test('keeps prior records visible when a refetch fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(inlineBody({ndjson: outputLine('alpha\n', 1), nextCursor: 5})),
      )
      .mockResolvedValueOnce(jsonResponse({code: 'server-error'}, {status: 500}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderStepLogsHook();
    await waitFor(() => expect(result.current.data?.records).toHaveLength(1));
    const refetch = await result.current.refetch();

    expect(refetch.error).toBeTruthy();
    expect(result.current.data?.records).toMatchObject([{type: 'output', data: 'alpha\n'}]);
  });

  test('retries transient initial errors before surfacing a failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({code: 'server-error'}, {status: 500}))
      .mockResolvedValueOnce(jsonResponse({code: 'server-error'}, {status: 500}))
      .mockResolvedValueOnce(
        jsonResponse(inlineBody({ndjson: outputLine('eventual logs\n', 1), nextCursor: 5})),
      );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderStepLogsHook(
      {stepId: STEP_ID, attempt: 1},
      {initialErrorRetryCount: 2, initialErrorRetryDelayMs: 10},
    );

    await waitFor(() => expect(result.current.data?.records).toHaveLength(1));
    expect(result.current.data?.records).toMatchObject([{type: 'output', data: 'eventual logs\n'}]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test('stops polling after a persistent error instead of re-polling the dead cursor', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(inlineBody({ndjson: outputLine('alpha\n', 1), nextCursor: 5, hasMore: true})),
      )
      .mockResolvedValue(jsonResponse({code: 'server-error'}, {status: 500}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderStepLogsHook();
    await waitFor(() => expect(result.current.data?.records).toHaveLength(1));
    await waitFor(() => expect(result.current.isError).toBe(true));
    const callsWhenErrored = fetchImpl.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(fetchImpl.mock.calls.length).toBe(callsWhenErrored);
  });

  test('keeps polling a missing stream when requested and merges the later response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({code: 'not-found'}, {status: 404}))
      .mockResolvedValueOnce(
        jsonResponse(
          inlineBody({ndjson: outputLine('stream created\n', 1), nextCursor: 5, hasMore: true}),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(inlineBody({ndjson: outputLine('next line\n', 2), nextCursor: 6})),
      );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderStepLogsHook({stepId: STEP_ID, attempt: 1}, {retryMissingStream: true});
    await waitFor(() => expect(result.current.isError).toBe(true));
    await waitFor(() => expect(result.current.data?.records).toHaveLength(2), {
      timeout: STEP_LOG_LIVE_REFETCH_MS + STEP_LOG_DRAIN_REFETCH_MS + 1_500,
    });
    expect(result.current.data?.records.map((record) => record.type)).toEqual(['output', 'output']);
    const urls = requestsFrom(fetchImpl).map((request) => new URL(request.url));
    expect(urls.map((url) => url.searchParams.get('cursor'))).toEqual(['0', '0', '5']);
  });

  test('settles a bounded missing stream retry window as complete empty logs', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({code: 'not-found'}, {status: 404}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderStepLogsHook(
      {stepId: STEP_ID, attempt: 1},
      {retryMissingStream: true, missingStreamRetryCount: 2, missingStreamRetryDelayMs: 10},
    );

    await waitFor(() => expect(result.current.data?.complete).toBe(true));
    expect(result.current.data?.records).toEqual([]);
    expect(result.current.data?.state).toBe('closed');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test('does not spend the bounded missing-stream budget on manual refreshes', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({code: 'not-found'}, {status: 404}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderStepLogsHook(
      {stepId: STEP_ID, attempt: 1},
      {retryMissingStream: true, missingStreamRetryCount: 1, missingStreamRetryDelayMs: 60_000},
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    const refresh = await result.current.refetchLogs();

    expect(refresh.error).toBeTruthy();
    expect(refresh.data).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('does not mark a reused initial request as a manual refresh', async () => {
    let resolveInitialRequest!: (response: Response) => void;
    const initialRequest = new Promise<Response>((resolve) => {
      resolveInitialRequest = resolve;
    });
    const fetchImpl = vi
      .fn()
      .mockReturnValueOnce(initialRequest)
      .mockResolvedValue(jsonResponse({code: 'not-found'}, {status: 404}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderStepLogsHook(
      {stepId: STEP_ID, attempt: 1},
      {retryMissingStream: true, missingStreamRetryCount: 1, missingStreamRetryDelayMs: 10},
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    const refresh = result.current.refetchLogs();
    resolveInitialRequest(jsonResponse({code: 'not-found'}, {status: 404}));
    await refresh;

    await waitFor(() => expect(result.current.data?.complete).toBe(true));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('starts a fresh bounded window after unbounded missing-stream polling', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({code: 'not-found'}, {status: 404}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const queryClient = new QueryClient({
      defaultOptions: {queries: {retry: false}},
    });
    const wrapper = ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const initialProps: {options: UseStepAttemptLogsQueryOptions} = {
      options: {retryMissingStream: true},
    };

    const {result, rerender} = renderHook(
      ({options}: {options: UseStepAttemptLogsQueryOptions}) =>
        useStepAttemptLogsQuery(STEP_ID, 1, options),
      {wrapper, initialProps},
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    await result.current.refetch();
    await result.current.refetch();

    rerender({
      options: {
        retryMissingStream: true,
        missingStreamRetryCount: 1,
        missingStreamRetryDelayMs: 10,
      },
    });
    const firstBoundedRefetch = await result.current.refetch();
    const secondBoundedRefetch = await result.current.refetch();

    expect(firstBoundedRefetch.data).toBeUndefined();
    expect(firstBoundedRefetch.error).toBeTruthy();
    expect(secondBoundedRefetch.data?.complete).toBe(true);
    expect(secondBoundedRefetch.data?.records).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  test('does not keep polling server errors when missing-stream retry is requested', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({code: 'server-error'}, {status: 500}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderStepLogsHook({stepId: STEP_ID, attempt: 1}, {retryMissingStream: true});
    await waitFor(() => expect(result.current.isError).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, STEP_LOG_LIVE_REFETCH_MS + 100));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('does not poll after a closed drained inline stream loads', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(inlineBody({ndjson: outputLine('done\n', 1), nextCursor: 1, state: 'closed'})),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderStepLogsHook();
    await waitFor(() => expect(result.current.data?.complete).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
