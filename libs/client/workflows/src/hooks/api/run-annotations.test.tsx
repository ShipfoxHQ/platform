import type {ReadAnnotationsResponseDto} from '@shipfox/annotations-dto';
import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, cleanup, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {RUN_ANNOTATIONS_POLL_MS} from '#core/run-annotation.js';
import {readAnnotationsResponseDto, runAnnotationDto} from '#test/fixtures/annotations.js';
import {
  getRunAnnotationsDtos,
  runAnnotationsQueryKeys,
  useRunAnnotationsQuery,
} from './run-annotations.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';

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

  return {queryClient, ...renderHook(callback, {wrapper})};
}

describe('run annotations API hooks', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    configureApiClient({baseUrl: '', fetchImpl: undefined});
  });

  it('paginates annotation reads into one DTO array', async () => {
    const first = runAnnotationDto({id: '11111111-1111-4111-8111-000000000001'});
    const second = runAnnotationDto({id: '11111111-1111-4111-8111-000000000002'});
    const responses: ReadAnnotationsResponseDto[] = [
      readAnnotationsResponseDto([first], {has_more: true, next_cursor: 'cursor-2'}),
      readAnnotationsResponseDto([second]),
    ];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse(responses.shift() ?? responses[0]),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const annotations = await getRunAnnotationsDtos({workflowRunId: RUN_ID, runAttempt: 2});

    expect(annotations).toEqual([first, second]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstUrl = requestUrl(fetchImpl.mock.calls[0]?.[0]);
    const secondUrl = requestUrl(fetchImpl.mock.calls[1]?.[0]);
    expect(firstUrl.pathname).toBe('/annotations');
    expect(firstUrl.searchParams.get('workflow_run_id')).toBe(RUN_ID);
    expect(firstUrl.searchParams.get('attempt')).toBe('2');
    expect(firstUrl.searchParams.get('cursor')).toBeNull();
    expect(secondUrl.searchParams.get('cursor')).toBe('cursor-2');
  });

  it('maps annotation DTOs to run annotation models while keeping the cache DTO-shaped', async () => {
    const dto = runAnnotationDto({
      id: '11111111-1111-4111-8111-000000000003',
      job_id: '22222222-2222-4222-8222-000000000003',
      body: 'Mapped body',
    });
    const fetchImpl = vi.fn(async () => jsonResponse(readAnnotationsResponseDto([dto])));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result, queryClient} = renderWithQueryClient(() =>
      useRunAnnotationsQuery({workflowRunId: RUN_ID, runAttempt: 1, runStatus: 'running'}),
    );

    await waitFor(() => expect(result.current.data?.[0]?.body).toBe('Mapped body'));
    expect(result.current.data?.[0]).toMatchObject({
      id: dto.id,
      jobId: dto.job_id,
      body: 'Mapped body',
    });
    expect(queryClient.getQueryData(runAnnotationsQueryKeys.detail(RUN_ID, 1))).toEqual([dto]);
  });

  it('polls while the run is running', async () => {
    vi.useFakeTimers({toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout']});
    const fetchImpl = vi.fn(async () => jsonResponse(readAnnotationsResponseDto([])));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    renderWithQueryClient(() =>
      useRunAnnotationsQuery({workflowRunId: RUN_ID, runAttempt: 1, runStatus: 'running'}),
    );

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUN_ANNOTATIONS_POLL_MS);
    });

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });

  it('keeps exactly three real polls after the run reaches a terminal status', async () => {
    vi.useFakeTimers({toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout']});
    const fetchImpl = vi.fn(async () => jsonResponse(readAnnotationsResponseDto([])));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    let runStatus: 'running' | 'succeeded' = 'running';
    const {rerender} = renderWithQueryClient(() =>
      useRunAnnotationsQuery({workflowRunId: RUN_ID, runAttempt: 1, runStatus}),
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    runStatus = 'succeeded';
    act(() => rerender());
    act(() => rerender());
    act(() => rerender());
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUN_ANNOTATIONS_POLL_MS);
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUN_ANNOTATIONS_POLL_MS);
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUN_ANNOTATIONS_POLL_MS);
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUN_ANNOTATIONS_POLL_MS);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('keeps the last annotations when a refresh fails', async () => {
    const dto = runAnnotationDto({body: 'first body'});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(readAnnotationsResponseDto([dto])))
      .mockResolvedValueOnce(jsonResponse({code: 'server-error'}, {status: 500}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {result, queryClient} = renderWithQueryClient(() =>
      useRunAnnotationsQuery({workflowRunId: RUN_ID, runAttempt: 1, runStatus: 'running'}),
    );
    await waitFor(() => expect(result.current.data?.[0]?.body).toBe('first body'));

    await act(async () => {
      await queryClient.refetchQueries({queryKey: runAnnotationsQueryKeys.detail(RUN_ID, 1)});
    });

    expect(result.current.data?.[0]?.body).toBe('first body');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stays idle when the run attempt is undefined', () => {
    const fetchImpl = vi.fn(async () => jsonResponse(readAnnotationsResponseDto([])));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderWithQueryClient(() =>
      useRunAnnotationsQuery({workflowRunId: RUN_ID, runAttempt: undefined, runStatus: 'running'}),
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function requestUrl(input: RequestInfo | URL | undefined): URL {
  if (input instanceof Request) return new URL(input.url);
  if (input) return new URL(String(input));
  throw new Error('Expected request input');
}
