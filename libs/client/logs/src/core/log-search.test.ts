import type {LogRecord} from './log-model.js';
import {buildLogSearchIndex, filterLogNodes} from './log-search.js';
import {buildLogTree, type GroupLogNode, type LogNode} from './log-tree.js';

const output = (data: string): LogRecord => ({
  v: 1,
  ts: 0,
  type: 'output',
  stream: 'stdout',
  data,
});

const groupStart = (
  groupId: string,
  name: string,
  parentGroupId: string | null = null,
): LogRecord => ({
  v: 1,
  ts: 0,
  type: 'group_start',
  groupId,
  parentGroupId,
  name,
});

const groupEnd = (groupId: string): LogRecord => ({
  v: 1,
  ts: 0,
  type: 'group_end',
  groupId,
});

const asGroup = (node: LogNode | undefined): GroupLogNode => {
  if (node?.kind !== 'group') throw new Error(`expected group, got ${node?.kind}`);
  return node;
};

describe('filterLogNodes', () => {
  test('keeps matching group ancestors and counts only visible output lines', () => {
    const tree = buildLogTree([
      groupStart('build', 'Build'),
      output('not this line'),
      output('\u001b[32mSuccess\u001b[0m: compiled'),
      groupEnd('build'),
    ]);

    const filtered = filterLogNodes(tree.nodes, 'success', buildLogSearchIndex(tree.nodes));
    const group = asGroup(filtered[0]);

    expect(group.children).toHaveLength(1);
    expect(group.children[0]?.kind).toBe('output');
    expect(group.lineCount).toBe(1);
  });

  test('keeps every child when the group name matches', () => {
    const tree = buildLogTree([
      groupStart('build', 'Build'),
      output('first'),
      output('second'),
      groupEnd('build'),
    ]);

    const filtered = filterLogNodes(tree.nodes, 'build', buildLogSearchIndex(tree.nodes));
    const group = asGroup(filtered[0]);

    expect(group.children).toHaveLength(2);
    expect(group.lineCount).toBe(2);
  });

  test('searches rendered labels and strips ANSI without matching structural fields', () => {
    const records: LogRecord[] = [
      output('\u001b[32mSuccess\u001b[0m: compiled'),
      {v: 1, ts: 0, type: 'gap', droppedBytes: 64},
      {
        v: 1,
        ts: 0,
        type: 'agent_session',
        row: {
          kind: 'message',
          timestamp: 0,
          role: 'assistant',
          label: 'assistant',
          meta: [],
          text: 'Validation passed.',
          terminalFailure: false,
        },
      },
    ];
    const tree = buildLogTree(records);
    const index = buildLogSearchIndex(tree.nodes);

    expect(filterLogNodes(tree.nodes, '  SUCCESS  ', index)).toHaveLength(1);
    expect(filterLogNodes(tree.nodes, 'output missing', index)).toHaveLength(1);
    expect(filterLogNodes(tree.nodes, 'error', index)).toHaveLength(0);
  });
});
