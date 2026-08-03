import {LogRows} from '@shipfox/react-ui/log';
import type {Meta, StoryObj} from '@storybook/react';
import {expect, userEvent, within} from 'storybook/test';
import type {GroupLogNode, GroupStartLogRecord, OutputLogRecord} from '#core/log-tree.js';
import {LogGroup} from './log-group.js';
import {OutputLogRow} from './output-log-row.js';
import {RunnerLostMarker} from './system-markers.js';

const origin = new Date('2026-06-23T10:00:00.000Z').getTime();
const at = (offsetSeconds: number) => origin + offsetSeconds * 1000;

const groupStart = (groupId: string, name: string): GroupStartLogRecord => ({
  v: 1,
  ts: at(0),
  type: 'group_start',
  groupId,
  parentGroupId: null,
  name,
});

const out = (
  data: string,
  line: number,
  stream: 'stdout' | 'stderr' = 'stdout',
): OutputLogRecord => ({
  v: 1,
  ts: at(line),
  type: 'output',
  stream,
  data,
});

const group = (over: Partial<GroupLogNode> & Pick<GroupLogNode, 'record'>): GroupLogNode => ({
  kind: 'group',
  seq: 0,
  closed: false,
  endTs: null,
  hasError: false,
  lineCount: 0,
  children: [],
  ...over,
});

const rows = (records: OutputLogRecord[]) =>
  records.map((record) => (
    <OutputLogRow key={record.ts + record.data} record={record} lineNumber={null} indent={1} />
  ));

const buildChildren = [
  out('Compiling 1284 modules\n', 1),
  out('Linking 318 packages\n', 2),
  out('Done\n', 3),
];

const meta = {
  title: 'Logs/LogGroup',
  component: LogGroup,
  parameters: {layout: 'padded'},
  tags: ['autodocs'],
} satisfies Meta<typeof LogGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

const BUILD_TRIGGER = /Build/;

export const Playground: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows>
        <LogGroup
          node={group({
            record: groupStart('g1', 'Build'),
            closed: true,
            endTs: at(3),
            lineCount: 3,
          })}
          depth={0}
          terminated={false}
        >
          {rows(buildChildren)}
        </LogGroup>
      </LogRows>
    </div>
  ),
};

export const Open: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows>
        <LogGroup
          node={group({
            record: groupStart('g1', 'Build'),
            closed: true,
            endTs: at(3),
            lineCount: 3,
          })}
          depth={0}
          terminated={false}
          defaultOpen
        >
          {rows(buildChildren)}
        </LogGroup>
      </LogRows>
    </div>
  ),
};

export const Running: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows>
        <LogGroup
          node={group({record: groupStart('g1', 'Build'), lineCount: 2})}
          depth={0}
          terminated={false}
          defaultOpen
        >
          {rows([out('Compiling...\n', 1), out('still going\n', 2)])}
        </LogGroup>
      </LogRows>
    </div>
  ),
};

export const Incomplete: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows>
        <LogGroup
          node={group({record: groupStart('g1', 'Build'), lineCount: 1})}
          depth={0}
          terminated
          defaultOpen
        >
          {rows([out('Compiling...\n', 1)])}
        </LogGroup>
      </LogRows>
    </div>
  ),
};

export const Truncated: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows>
        <LogGroup
          node={group({
            record: groupStart('g1', 'Build'),
            closed: true,
            endTs: null,
            lineCount: 1,
          })}
          depth={0}
          terminated={false}
          defaultOpen
        >
          {rows([out('Compiling...\n', 1)])}
        </LogGroup>
      </LogRows>
    </div>
  ),
};

/**
 * A genuine subtree failure (a `runner_lost`) draws an inset red bar on the header (a
 * border, not a fill). stderr alone never triggers it: stderr is a channel, not an error.
 */
export const ErrorBar: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows>
        <LogGroup
          node={group({
            record: groupStart('g1', 'Build'),
            closed: true,
            endTs: null,
            hasError: true,
            lineCount: 1,
          })}
          depth={0}
          terminated
        >
          <OutputLogRow record={out('connecting to runner...\n', 1)} lineNumber={null} indent={1} />
          <RunnerLostMarker record={{v: 1, ts: at(2), type: 'runner_lost'}} />
        </LogGroup>
      </LogRows>
    </div>
  ),
};

export const Toggle: Story = {
  ...Playground,
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const trigger = canvas.getByRole('button', {name: BUILD_TRIGGER});

    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  },
};
