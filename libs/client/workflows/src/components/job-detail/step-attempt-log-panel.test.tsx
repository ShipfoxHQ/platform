import {configureApiClient} from '@shipfox/client-api';
import {type StepLogSnapshot, stepLogsQueryKeys} from '@shipfox/client-logs';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {createRef, type ReactNode} from 'react';
import {inlineLogBody, outputLine} from '#test/fixtures/logs.js';
import {StepAttemptLogPanel} from './step-attempt-log-panel.js';

const STEP_ID = '99999999-9999-4999-8999-999999999999';
const WAITING_FOR_OUTPUT_PATTERN = /Waiting for output ·/;
type TestLogRecord = StepLogSnapshot['records'][number];

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

const outputRecord = (data: string, ts = 1): TestLogRecord => ({
  v: 1,
  ts,
  type: 'output',
  stream: 'stdout',
  data,
});

function snapshot(records: TestLogRecord[]): StepLogSnapshot {
  return {
    records,
    nextCursor: records.length,
    source: 'inline',
    state: 'closed',
    complete: true,
    hasMore: false,
    truncated: false,
    totalBytes: null,
    expiresAt: null,
  };
}

function renderPanel(
  props: Partial<Parameters<typeof StepAttemptLogPanel>[0]> = {},
  options: {queryClient?: QueryClient} = {},
) {
  const queryClient =
    options.queryClient ??
    new QueryClient({
      defaultOptions: {queries: {retry: false}},
    });
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const pageScrollRef = createRef<HTMLDivElement>();

  return {
    queryClient,
    ...render(
      <div ref={pageScrollRef}>
        <StepAttemptLogPanel
          stepId={STEP_ID}
          attempt={1}
          attemptStatus="running"
          pageScrollRef={pageScrollRef}
          {...props}
        />
      </div>,
      {wrapper},
    ),
  };
}

describe('StepAttemptLogPanel', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    configureApiClient({baseUrl: '', fetchImpl: undefined});
  });

  test('waits for missing logs while the attempt is running', async () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () => jsonResponse({code: 'not-found'}, {status: 404})),
    });

    const {container} = renderPanel();

    expect(await screen.findByRole('status', {name: 'Waiting for logs'})).toBeInTheDocument();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="log-rows"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  test('shows elapsed waiting-for-output time for a running attempt', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-26T12:01:14.000Z'));
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () => jsonResponse({code: 'not-found'}, {status: 404})),
    });

    renderPanel({attemptStartedAt: '2026-06-26T11:59:00.000Z'});

    expect(await screen.findByText(WAITING_FOR_OUTPUT_PATTERN)).toBeInTheDocument();
    expect(screen.getByText('2m 14s')).toHaveAttribute('aria-hidden', 'true');
  });

  test('waits for missing logs on a terminal attempt until the stream appears', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({code: 'not-found'}, {status: 404}))
      .mockResolvedValueOnce(
        jsonResponse(inlineLogBody(outputLine('eventual terminal logs\n'), 1)),
      );
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
    });

    const {queryClient} = renderPanel({
      attemptStatus: 'succeeded',
      initialErrorRetryCount: 2,
      initialErrorRetryDelayMs: 60_000,
    });

    expect(await screen.findByRole('status', {name: 'Waiting for logs'})).toBeInTheDocument();
    await act(async () => {
      await queryClient.refetchQueries({queryKey: stepLogsQueryKeys.detail(STEP_ID, 1)});
    });
    expect(await screen.findByText('eventual terminal logs')).toBeInTheDocument();
    expect(screen.queryByText('Could not load logs.')).not.toBeInTheDocument();
  });

  test('settles a terminal missing log stream to no output instead of an error', async () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () => jsonResponse({code: 'not-found'}, {status: 404})),
    });

    const {queryClient} = renderPanel({
      attemptStatus: 'succeeded',
      initialErrorRetryCount: 1,
      initialErrorRetryDelayMs: 60_000,
    });

    expect(await screen.findByRole('status', {name: 'Waiting for logs'})).toBeInTheDocument();
    await act(async () => {
      await queryClient.refetchQueries({queryKey: stepLogsQueryKeys.detail(STEP_ID, 1)});
    });
    expect(await screen.findByText('Step produced no output')).toBeInTheDocument();
    expect(screen.queryByText('Could not load logs.')).not.toBeInTheDocument();
  });

  test('keeps the log loading surface through transient initial server errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({code: 'server-error'}, {status: 500}))
      .mockResolvedValueOnce(jsonResponse(inlineLogBody(outputLine('eventual logs\n'), 1)));
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
    });

    const {container} = renderPanel({
      attemptStatus: 'failed',
      initialErrorRetryCount: 1,
      initialErrorRetryDelayMs: 10,
    });
    expect(screen.getByRole('status', {name: 'Loading logs'})).toBeInTheDocument();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="log-rows"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );

    expect(await screen.findByText('eventual logs')).toBeInTheDocument();
    expect(screen.getByRole('log')).toBeInTheDocument();
  });

  test('shows a compact retry state after the initial error retry budget is exhausted', async () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () => jsonResponse({code: 'server-error'}, {status: 500})),
    });

    renderPanel({attemptStatus: 'failed', initialErrorRetryCount: 1, initialErrorRetryDelayMs: 10});
    expect(screen.getByRole('status', {name: 'Loading logs'})).toBeInTheDocument();

    expect(await screen.findByText('Could not load logs.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Retry'})).toBeInTheDocument();
  });

  test('renders loaded logs inline', async () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () => jsonResponse(inlineLogBody(outputLine('hello\n'), 1))),
    });

    renderPanel({attemptStatus: 'succeeded'});

    expect(await screen.findByText('hello')).toBeInTheDocument();
  });

  test('renders a terminal closed empty stream as no output', async () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () => jsonResponse(inlineLogBody('', 0))),
    });

    renderPanel({attemptStatus: 'succeeded'});

    expect(await screen.findByText('Step produced no output')).toBeInTheDocument();
    expect(
      screen.getByText('This log stream closed without session entries or process output.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('log')).toBeInTheDocument();
  });

  test('keeps stale logs visible when a refresh fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(inlineLogBody(outputLine('first\n'), 1)))
      .mockResolvedValueOnce(jsonResponse({code: 'server-error'}, {status: 500}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {queryClient} = renderPanel({attemptStatus: 'running'});
    await screen.findByText('first');

    await act(async () => {
      await queryClient.refetchQueries({queryKey: stepLogsQueryKeys.detail(STEP_ID, 1)});
    });

    expect(screen.getByText('first')).toBeInTheDocument();
    expect(await screen.findByText('Could not refresh logs.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Retry'})).toBeInTheDocument();
  });

  test('does not follow new log output after the user scrolls away from the tail', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: vi.fn()});
    const queryClient = new QueryClient({
      defaultOptions: {queries: {retry: false, staleTime: Number.POSITIVE_INFINITY}},
    });
    const queryKey = stepLogsQueryKeys.detail(STEP_ID, 1);
    queryClient.setQueryData(queryKey, snapshot([outputRecord('first\n')]));
    const {container} = renderPanel({attemptStatus: 'succeeded'}, {queryClient});
    const pageScroll = container.firstElementChild as HTMLElement;
    Object.defineProperty(pageScroll, 'scrollHeight', {configurable: true, value: 600});
    Object.defineProperty(pageScroll, 'clientHeight', {configurable: true, value: 200});
    pageScroll.scrollTop = 320;
    fireEvent.scroll(pageScroll);

    act(() => {
      queryClient.setQueryData(
        queryKey,
        snapshot([outputRecord('first\n'), outputRecord('second\n', 2)]),
      );
    });

    await waitFor(() => expect(screen.getByText('second')).toBeInTheDocument());
    expect(pageScroll.scrollTop).toBe(320);
  });

  test('passes failure anchoring for failed attempts', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          inlineLogBody(
            JSON.stringify({
              v: 1,
              ts: 1,
              type: 'agent_session',
              row: {
                kind: 'message',
                timestamp: 1,
                role: 'assistant',
                label: 'assistant',
                meta: [],
                text: 'I cannot continue.',
                terminalFailure: true,
              },
            }),
            1,
          ),
        ),
      ),
    });

    renderPanel({attemptStatus: 'failed'});

    expect(await screen.findByText('I cannot continue.')).toBeInTheDocument();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({block: 'center'}));
  });
});
