import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import type {LogRecord} from '#core/log-model.js';
import {LogView, LogViewSkeleton} from './log-view.js';

const ts = new Date('2026-06-23T10:00:00.000Z').getTime();
const THINKING_BUTTON_NAME = /thinking/i;

const output = (data: string): LogRecord => ({
  v: 1,
  ts,
  type: 'output',
  stream: 'stdout',
  data,
});
const groupStart = (groupId: string, name: string): LogRecord => ({
  v: 1,
  ts,
  type: 'group_start',
  groupId,
  parentGroupId: null,
  name,
});
const groupEnd = (groupId: string): LogRecord => ({
  v: 1,
  ts,
  type: 'group_end',
  groupId,
});
type AgentSessionRow = Extract<LogRecord, {type: 'agent_session'}>['row'];

const agentSession = (row: AgentSessionRow, offsetMs = 0): LogRecord => ({
  v: 1,
  ts: ts + offsetMs,
  type: 'agent_session',
  row,
});

describe('LogView', () => {
  let scrollIntoViewDescriptor: PropertyDescriptor | undefined;
  let scrollIntoViewWasStubbed = false;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (scrollIntoViewWasStubbed) {
      if (scrollIntoViewDescriptor != null) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
      }
    }
    scrollIntoViewDescriptor = undefined;
    scrollIntoViewWasStubbed = false;
  });

  test('renders the complete empty state for an empty closed stream', () => {
    render(<LogView records={[]} />);

    expect(screen.getByText('Step produced no output')).toBeDefined();
    expect(
      screen.getByText('This log stream closed without session entries or process output.'),
    ).toBeDefined();
    expect(screen.getByRole('log')).toBeDefined();
  });

  test('renders the pending empty state for an empty open stream', () => {
    render(<LogView records={[]} emptyState="pending" />);

    expect(screen.getByText('No output yet')).toBeDefined();
    expect(screen.getByText('New lines will appear here as the step writes them.')).toBeDefined();
    expect(screen.queryByText('Step produced no output')).toBeNull();
  });

  test('renders no-output copy before the end marker for an end-marker-only stream', () => {
    render(<LogView records={[{v: 1, ts, type: 'end', totalBytes: 0}]} />);

    expect(screen.getByText('Step produced no output')).toBeDefined();
    expect(screen.getByText('End of log')).toBeDefined();
    expect(screen.getByText('0 lines · 0 B · 0ms')).toBeDefined();
  });

  test.each([
    {record: {v: 1, ts, type: 'runner_lost'} as const, label: 'Runner disconnected'},
    {record: {v: 1, ts, type: 'gap', droppedBytes: 2048} as const, label: 'Output missing'},
    {record: {v: 1, ts, type: 'capped'} as const, label: 'Log size limit reached'},
  ])('does not show no-output copy for a $record.type marker-only stream', ({record, label}) => {
    render(<LogView records={[record]} />);

    expect(screen.getByText(label)).toBeDefined();
    expect(screen.queryByText('Step produced no output')).toBeNull();
    expect(screen.queryByText('No output yet')).toBeNull();
  });

  test('does not render empty copy when output exists', () => {
    render(<LogView records={[output('hello\n')]} />);

    expect(screen.getByText('hello')).toBeDefined();
    expect(screen.queryByText('Step produced no output')).toBeNull();
    expect(screen.queryByText('No output yet')).toBeNull();
  });

  test('filters output and session rows by the log search term', () => {
    render(
      <LogView
        search="failure"
        records={[
          output('setup complete\n'),
          output('failure: test failed\n'),
          agentSession({
            kind: 'message',
            timestamp: ts,
            role: 'assistant',
            label: 'assistant',
            meta: [],
            text: 'The failure is in the validation step.',
            terminalFailure: false,
          }),
        ]}
      />,
    );

    expect(screen.getByText('failure: test failed')).toBeDefined();
    expect(screen.getByText('The failure is in the validation step.')).toBeDefined();
    expect(screen.queryByText('setup complete')).toBeNull();
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'off');
    expect(screen.getByRole('status')).toHaveTextContent('Log search updated for “failure”.');
  });

  test('opens matching groups and filters their children', () => {
    render(
      <LogView
        search="success"
        records={[
          groupStart('build', 'Build'),
          output('setup complete\n'),
          output('Success: compiled\n'),
          groupEnd('build'),
        ]}
      />,
    );

    expect(screen.getByText('Success: compiled')).toBeInTheDocument();
    expect(screen.queryByText('setup complete')).not.toBeInTheDocument();
    expect(screen.getByText('1 line')).toBeInTheDocument();
  });

  test('normalizes search text and restores all rows when search is cleared', async () => {
    const records = [output('Failure: validation failed\n'), output('success: recovered\n')];
    const {rerender} = render(<LogView search="  FAILURE  " records={records} />);

    await waitFor(() => expect(screen.getByText('Failure: validation failed')).toBeInTheDocument());
    expect(screen.queryByText('success: recovered')).not.toBeInTheDocument();

    rerender(<LogView search="" records={records} />);

    await waitFor(() => expect(screen.getByText('success: recovered')).toBeInTheDocument());
  });

  test('searches marker labels and drops groups without matching descendants', () => {
    render(
      <LogView
        search="missing"
        records={[
          groupStart('build', 'Build'),
          output('build succeeded\n'),
          groupEnd('build'),
          groupStart('deploy', 'Deploy'),
          output('deploy started\n'),
          groupEnd('deploy'),
          {v: 1, ts, type: 'gap', droppedBytes: 64},
        ]}
      />,
    );

    expect(screen.getByText('Output missing')).toBeInTheDocument();
    expect(screen.queryByText('Build')).not.toBeInTheDocument();
    expect(screen.queryByText('Deploy')).not.toBeInTheDocument();
  });

  test('shows a message when the log search has no matches', () => {
    render(<LogView search="missing" records={[output('hello\n')]} />);

    expect(screen.getByRole('status')).toHaveTextContent('No log lines match “missing”.');
    expect(screen.queryByText('hello')).toBeNull();
  });

  test('allows terminal logs to opt out of live announcements', () => {
    render(<LogView records={[output('hello\n')]} ariaLive="off" />);

    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'off');
  });

  test('renders assistant session text and collapsed thinking', () => {
    render(
      <LogView
        records={[
          agentSession({
            kind: 'message',
            timestamp: ts,
            role: 'assistant',
            label: 'assistant',
            meta: [],
            text: 'I will inspect the failure.',
            terminalFailure: false,
          }),
          agentSession({
            kind: 'thinking',
            timestamp: ts,
            text: 'The stack trace points at validation.',
          }),
        ]}
      />,
    );

    expect(screen.getByText('I will inspect the failure.')).toBeDefined();
    expect(screen.getByRole('button', {name: THINKING_BUTTON_NAME})).toBeDefined();
    expect(screen.queryByText('The stack trace points at validation.')).toBeNull();

    fireEvent.click(screen.getByRole('button', {name: THINKING_BUTTON_NAME}));

    expect(screen.getByText('The stack trace points at validation.')).toBeDefined();
  });

  test('renders tool calls with awaiting state until a result appears later in the stream', () => {
    render(
      <LogView
        records={[
          agentSession({
            kind: 'tool-call',
            timestamp: ts,
            id: 'call-1',
            name: 'edit_file',
            input: '{}',
          }),
          output('stdout between call and result\n'),
          agentSession({
            kind: 'tool-result',
            timestamp: ts + 1,
            toolCallId: 'call-1',
            toolName: 'tool',
            output: 'patched',
            isError: false,
          }),
        ]}
      />,
    );

    expect(screen.getByText('tool edit_file')).toBeDefined();
    expect(screen.getByText('stdout between call and result')).toBeDefined();
    expect(screen.getByText('result edit_file')).toBeDefined();
    expect(screen.queryByText('awaiting result')).toBeNull();
  });

  test('marks a tool result without a matching tool call as unmatched', () => {
    render(
      <LogView
        records={[
          agentSession({
            kind: 'tool-result',
            timestamp: ts,
            toolCallId: 'missing-call',
            toolName: 'tool',
            output: 'result arrived without its call',
            isError: false,
          }),
        ]}
      />,
    );

    expect(screen.getByText('result (unmatched)')).toBeDefined();
  });

  test('shows the awaiting-result state for a tool call with no matching result', () => {
    render(
      <LogView
        records={[
          agentSession({
            kind: 'tool-call',
            timestamp: ts,
            id: 'call-1',
            name: 'edit_file',
            input: '{}',
          }),
        ]}
      />,
    );

    expect(screen.getByText('tool edit_file')).toBeDefined();
    expect(screen.getByText('awaiting result')).toBeDefined();
  });

  test('keeps tool relationships when search matches only one side', () => {
    const records = [
      agentSession({
        kind: 'tool-call',
        timestamp: ts,
        id: 'call-1',
        name: 'edit_file',
        input: '{}',
      }),
      agentSession({
        kind: 'tool-result',
        timestamp: ts + 1,
        toolCallId: 'call-1',
        toolName: 'edit_file',
        output: 'patched',
        isError: false,
      }),
    ];

    const {unmount} = render(<LogView search="{}" records={records} />);
    expect(screen.queryByText('awaiting result')).not.toBeInTheDocument();

    unmount();
    render(<LogView search="patched" records={records} />);
    expect(screen.getByText('result edit_file')).toBeInTheDocument();
    expect(screen.queryByText('result (unmatched)')).not.toBeInTheDocument();
  });

  test('renders unknown session entries without crashing', () => {
    render(
      <LogView
        records={[
          agentSession({
            kind: 'raw',
            timestamp: ts,
            label: 'Unknown session entry: future_entry',
            raw: '{"type":"future_entry","payload":{"value":true}}',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Unknown session entry: future_entry')).toBeDefined();
  });

  test('truncates large payloads with a show-more control', () => {
    render(
      <LogView
        records={[
          agentSession({
            kind: 'message',
            timestamp: ts,
            role: 'assistant',
            label: 'assistant',
            meta: [],
            text: 'x'.repeat(1500),
            terminalFailure: false,
          }),
        ]}
      />,
    );

    const toggle = screen.getByRole('button', {name: 'show more'});
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);

    expect(screen.getByRole('button', {name: 'show less'}).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  test('anchors terminal failures once while search changes', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    );
    scrollIntoViewWasStubbed = true;
    if (scrollIntoViewDescriptor == null) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: () => undefined,
      });
    }
    const scrollIntoView = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined);

    const records = [
      output('setup\n'),
      agentSession({
        kind: 'message',
        timestamp: ts,
        role: 'assistant',
        label: 'assistant',
        meta: [],
        text: 'I cannot continue.',
        terminalFailure: true,
      }),
    ];
    const {rerender} = render(<LogView anchorToFailure records={records} search="cannot" />);

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({block: 'center'}));
    scrollIntoView.mockClear();

    rerender(<LogView anchorToFailure records={records} search="missing" />);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('LogViewSkeleton', () => {
  test('keeps visual log chrome without exposing fake log content', () => {
    const {container} = render(<LogViewSkeleton rows={3} />);

    expect(screen.queryByRole('log')).toBeNull();
    expect(container.querySelector('[data-slot="log-rows"]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(container.querySelectorAll('[data-slot="log-row"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
  });
});
