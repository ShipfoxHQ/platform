import type {Meta, StoryObj} from '@storybook/react';
import type {LogRecord, SessionViewRow} from '#core/log-model.js';
import {LogView, LogViewSkeleton} from './log-view.js';

const ESC = String.fromCharCode(27);
const origin = new Date('2026-06-23T10:00:00.000Z').getTime();
const at = (offsetSeconds: number) => origin + offsetSeconds * 1000;

const out = (data: string, offset: number, stream: 'stdout' | 'stderr' = 'stdout'): LogRecord => ({
  v: 1,
  ts: at(offset),
  type: 'output',
  stream,
  data,
});
const session = (row: SessionViewRow, offset: number): LogRecord => ({
  v: 1,
  ts: at(offset),
  type: 'agent_session',
  row: {...row, timestamp: at(offset)},
});
const groupStart = (
  groupId: string,
  name: string,
  offset: number,
  parentGroupId: string | null = null,
): LogRecord => ({
  v: 1,
  ts: at(offset),
  type: 'group_start',
  groupId,
  parentGroupId,
  name,
});
const groupEnd = (groupId: string, offset: number): LogRecord => ({
  v: 1,
  ts: at(offset),
  type: 'group_end',
  groupId,
});

const toolResultResolutionRecords: LogRecord[] = [
  session(
    {
      kind: 'tool-call',
      timestamp: 0,
      id: 'claude-tool-1',
      name: 'mcp__shipfox_integration_tools__linear_shipfox__list_teams',
      input: '{"workspace":"shipfox"}',
    },
    0,
  ),
  session(
    {
      kind: 'tool-result',
      timestamp: 0,
      toolCallId: 'claude-tool-1',
      toolName: 'tool',
      output: '[{"name":"Engineering"}]',
      isError: false,
    },
    1,
  ),
  session(
    {
      kind: 'tool-result',
      timestamp: 0,
      toolCallId: 'missing-tool',
      toolName: 'tool',
      output: 'The matching call was not included in this stream.',
      isError: true,
    },
    2,
  ),
];

const showcaseRecords: LogRecord[] = [
  out('$ pnpm build && pnpm test\n', 0),
  groupStart('g1', 'Install dependencies', 1),
  out('Resolving packages...\n', 2),
  out('Linking 318 packages\n', 3),
  groupEnd('g1', 4),
  groupStart('g2', 'Build', 5),
  out(`${ESC}[32m✓${ESC}[0m built ${ESC}[34m1284${ESC}[0m modules\n`, 6),
  out('warn: deprecated glob@7, upgrade to glob@10\n', 7, 'stderr'),
  groupEnd('g2', 8),
  groupStart('g3', 'Test', 9),
  out('running 42 tests\n', 10),
  out('FAIL client.test.ts > retries on 503\n', 11, 'stderr'),
  groupEnd('g3', 12),
  {v: 1, ts: at(13), type: 'gap', droppedBytes: 2048},
  {v: 1, ts: at(14), type: 'end', totalBytes: 15_360},
];

// A pipeline nested three levels deep: Deploy > Build > Compile, and Deploy >
// Test > {unit, e2e}. The e2e leaf writes to stderr, so its error bubbles up to
// Test and the top-level pipeline (visible as an inset bar when those groups are
// collapsed); the Build branch stays clean. Closed inner groups carry a duration.
const nestedRecords: LogRecord[] = [
  groupStart('g1', 'Deploy pipeline', 0),
  out('$ ./deploy.sh\n', 0.1),
  groupStart('g2', 'Build', 1, 'g1'),
  out('resolving workspace graph\n', 1.2),
  groupStart('g3', 'Compile @app/web', 2, 'g2'),
  out(`${ESC}[32m✓${ESC}[0m built ${ESC}[34m842${ESC}[0m modules\n`, 3),
  groupEnd('g3', 4),
  groupStart('g4', 'Compile @app/api', 4.2, 'g2'),
  out('tsc --build\n', 5),
  out('✓ 1.1k files emitted\n', 6),
  groupEnd('g4', 7),
  groupEnd('g2', 7.5),
  groupStart('g5', 'Test', 8, 'g1'),
  groupStart('g6', 'unit', 8.2, 'g5'),
  out('running 128 tests\n', 9),
  out('✓ 128 passed\n', 10),
  groupEnd('g6', 11),
  groupStart('g7', 'e2e', 11.2, 'g5'),
  out('running 12 specs\n', 12),
  out('FAIL checkout.spec.ts > applies coupon at checkout\n', 13, 'stderr'),
  groupEnd('g7', 14),
  groupEnd('g5', 14.5),
  groupEnd('g1', 15),
  {v: 1, ts: at(15.2), type: 'end', totalBytes: 9_216},
];

const unifiedAgentRecords: LogRecord[] = [
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'user',
      label: 'user',
      meta: [],
      text: 'Update the auth form error handling.',
      terminalFailure: false,
    },
    0,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'assistant',
      label: 'assistant',
      meta: [{label: 'model', value: 'gpt-5-codex'}],
      text: 'I will inspect the form and the existing tests first.',
      terminalFailure: false,
    },
    1,
  ),
  session(
    {
      kind: 'thinking',
      timestamp: 0,
      text: 'The likely risk is server errors being written to the wrong form meta slot.',
    },
    1.1,
  ),
  session(
    {
      kind: 'tool-call',
      timestamp: 0,
      id: 'call-1',
      name: 'read_file',
      input: JSON.stringify({path: 'src/login-form.tsx'}, null, 2),
    },
    1.2,
  ),
  out('$ pnpm --filter @shipfox/client-auth test\n', 2),
  session(
    {
      kind: 'tool-result',
      timestamp: 0,
      toolCallId: 'call-1',
      toolName: 'read_file',
      output: 'export function LoginForm() { /* ... */ }',
      isError: false,
    },
    3,
  ),
  session(
    {
      kind: 'lifecycle',
      timestamp: 0,
      label: 'Model changed',
      detail: 'gpt-5-codex',
      meta: [{label: 'provider', value: 'openai'}],
      tone: 'default',
      terminalFailure: false,
    },
    4,
  ),
  {v: 1, ts: at(5), type: 'end', totalBytes: 4096},
];

const awaitingAgentRecords: LogRecord[] = [
  session(
    {
      kind: 'tool-call',
      timestamp: 0,
      id: 'call-2',
      name: 'run_tests',
      input: JSON.stringify({filter: '@shipfox/client-logs'}, null, 2),
    },
    0,
  ),
  out('running tests...\n', 1),
];

const failedAgentRecords: LogRecord[] = [
  out('$ pnpm test\n', 0),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'assistant',
      label: 'assistant',
      meta: [],
      text: 'The run cannot continue because the harness aborted.',
      terminalFailure: true,
    },
    1,
  ),
];

const allAgentSessionTypeRecords: LogRecord[] = [
  session(
    {
      kind: 'lifecycle',
      timestamp: 0,
      label: 'Session started',
      detail: 'session-2026-06-23',
      meta: [{label: 'cwd', value: '/workspace/platform'}],
      tone: 'default',
      terminalFailure: false,
    },
    0,
  ),
  session(
    {
      kind: 'lifecycle',
      timestamp: 0,
      label: 'Session info',
      detail: 'Restored 14 messages from prior context.',
      meta: [],
      tone: 'default',
      terminalFailure: false,
    },
    1,
  ),
  session(
    {
      kind: 'lifecycle',
      timestamp: 0,
      label: 'Review setup',
      detail: 'entry-review',
      meta: [],
      tone: 'default',
      terminalFailure: false,
    },
    2,
  ),
  session(
    {
      kind: 'lifecycle',
      timestamp: 0,
      label: 'Thinking level changed',
      detail: 'high',
      meta: [],
      tone: 'default',
      terminalFailure: false,
    },
    3,
  ),
  session(
    {
      kind: 'lifecycle',
      timestamp: 0,
      label: 'Model changed',
      detail: 'gpt-5-codex',
      meta: [{label: 'provider', value: 'openai'}],
      tone: 'default',
      terminalFailure: false,
    },
    4,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'user',
      label: 'user',
      meta: [{label: 'attachment', value: 'image/png'}],
      text: 'Review the failed workflow attempt and patch the tests.',
      terminalFailure: false,
    },
    5,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'assistant',
      label: 'assistant',
      meta: [
        {label: 'model', value: 'gpt-5-codex'},
        {label: 'provider', value: 'openai'},
      ],
      text: 'I will inspect the failure anchor and the log renderer.',
      terminalFailure: false,
    },
    6,
  ),
  session(
    {
      kind: 'thinking',
      timestamp: 0,
      text: 'The UI needs to preserve the terminal assistant message while still showing the tool activity inline.',
    },
    6.1,
  ),
  session(
    {
      kind: 'tool-call',
      timestamp: 0,
      id: 'call-read',
      name: 'read_file',
      input: JSON.stringify({path: 'libs/client/logs/src/components/log-view.tsx'}, null, 2),
    },
    6.2,
  ),
  session(
    {
      kind: 'tool-result',
      timestamp: 0,
      toolCallId: 'call-read',
      toolName: 'read_file',
      output: '<AgentSessionRows rows={[node.record.row]} />',
      isError: false,
    },
    7,
  ),
  session(
    {
      kind: 'tool-result',
      timestamp: 0,
      toolCallId: 'call-test',
      toolName: 'run_tests',
      output: 'FAIL log-view.test.tsx > renders tool results',
      isError: true,
    },
    8,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'system',
      label: 'branch summary',
      meta: [{label: 'from', value: 'entry-review'}],
      text: 'Kept the renderer scoped to canonical agent_session rows and log-tree ordering.',
      terminalFailure: false,
    },
    9,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'system',
      label: 'compaction',
      meta: [{label: 'tokens', value: '42000'}],
      text: 'Previous context summarized into 3 decisions.',
      terminalFailure: false,
    },
    10,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'system',
      label: 'custom',
      meta: [{label: 'type', value: 'review'}],
      text: '{"verdict":"coverage looks complete"}',
      terminalFailure: false,
    },
    11,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'system',
      label: 'operator note',
      meta: [],
      text: 'Retry after the fixture update.',
      terminalFailure: false,
    },
    12,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'assistant',
      label: 'assistant',
      meta: [{label: 'error', value: 'Harness aborted before the retry finished.'}],
      text: 'I cannot continue because the test harness aborted.',
      terminalFailure: true,
    },
    13,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'tool',
      label: 'bash execution',
      meta: [
        {label: 'command', value: 'pnpm test'},
        {label: 'exit', value: '1'},
        {label: 'truncated', value: 'true'},
        {label: 'full output', value: '/tmp/shipfox-agent-output.log', inline: false},
      ],
      text: 'FAIL log-view.test.tsx > renders tool results',
      terminalFailure: false,
    },
    14,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'custom',
      label: 'status',
      meta: [],
      text: 'Extension status update.',
      terminalFailure: false,
    },
    15,
  ),
  session(
    {
      kind: 'raw',
      timestamp: 0,
      label: 'Unknown session entry: future_entry',
      raw: '{"type":"future_entry","payload":{"feature":"new-session-event"}}',
    },
    16,
  ),
  session({kind: 'raw', timestamp: 0, label: 'Malformed session entry', raw: '{not-json'}, 17),
  {v: 1, ts: at(20), type: 'end', totalBytes: 12_288},
];

const meta = {
  title: 'Logs/LogView',
  component: LogView,
  parameters: {layout: 'padded'},
  tags: ['autodocs'],
  argTypes: {
    timestamps: {control: 'inline-radio', options: ['off', 'rel', 'abs']},
    wrap: {control: 'boolean'},
    showLineNumbers: {control: 'boolean'},
  },
  args: {
    timestamps: 'off',
    wrap: false,
    showLineNumbers: true,
  },
} satisfies Meta<typeof LogView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={showcaseRecords} />
    </div>
  ),
};

/**
 * Groups nested three levels deep (Deploy > Build > Compile, Deploy > Test >
 * unit/e2e). Each level indents; the failing `e2e` leaf bubbles its error up to
 * `Test` and `Deploy pipeline`. Collapse any group to see its "N lines" summary,
 * duration, and (for a branch with a failure) the inset error bar.
 */
export const NestedGroups: Story = {
  args: {defaultGroupsOpen: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={nestedRecords} />
    </div>
  ),
};

export const ClosedEmpty: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={[]} />
    </div>
  ),
};

export const PendingEmpty: Story = {
  args: {showLineNumbers: true, emptyState: 'pending'},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={[]} />
    </div>
  ),
};

export const MinimalOutput: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={[{v: 1, ts: at(1), type: 'end', totalBytes: 0}]} />
    </div>
  ),
};

export const UnifiedAgentSession: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={unifiedAgentRecords} />
    </div>
  ),
};

export const AllAgentSessionTypes: Story = {
  args: {showLineNumbers: true, anchorToFailure: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={allAgentSessionTypeRecords} />
    </div>
  ),
};

export const RunningAgentToolCall: Story = {
  args: {showLineNumbers: true, emptyState: 'pending'},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={awaitingAgentRecords} />
    </div>
  ),
};

export const ClaudeToolResultResolution: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={toolResultResolutionRecords} />
    </div>
  ),
};

export const FailedAgentSession: Story = {
  args: {showLineNumbers: true, anchorToFailure: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={failedAgentRecords} />
    </div>
  ),
};

export const UnknownAgentEntry: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView
        {...args}
        records={[
          session(
            {
              kind: 'raw',
              timestamp: 0,
              label: 'Unknown session entry: future_entry',
              raw: '{"type":"future_entry","payload":{"value":true}}',
            },
            0,
          ),
        ]}
      />
    </div>
  ),
};

export const LargeAgentPayload: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView
        {...args}
        records={[
          session(
            {
              kind: 'message',
              timestamp: 0,
              role: 'assistant',
              label: 'assistant',
              meta: [],
              text: 'Large payload '.repeat(180),
              terminalFailure: false,
            },
            0,
          ),
        ]}
      />
    </div>
  ),
};

export const LoadingSkeleton: Story = {
  render: (args) => (
    <div className="max-w-3xl">
      <LogViewSkeleton
        timestamps={args.timestamps}
        wrap={args.wrap}
        showLineNumbers={args.showLineNumbers}
      />
    </div>
  ),
};
