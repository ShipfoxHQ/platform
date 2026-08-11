import type {SessionViewRow} from './log-model.js';
import {assertNever, type LogNode, stripTrailingNewline} from './log-tree.js';

const ANSI_SGR_SEQUENCE = new RegExp(`${String.fromCodePoint(0x1b)}\\[[0-9;]*m`, 'g');

export interface LogSearchIndex {
  textBySeq: ReadonlyMap<number, string>;
}

export function buildLogSearchIndex(nodes: readonly LogNode[]): LogSearchIndex {
  const textBySeq = new Map<number, string>();
  indexNodes(nodes, textBySeq);
  return {textBySeq};
}

export function filterLogNodes(
  nodes: readonly LogNode[],
  query: string,
  index: LogSearchIndex,
): LogNode[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return filterLogNodesInternal(nodes, normalizedQuery, index);
}

function filterLogNodesInternal(
  nodes: readonly LogNode[],
  query: string,
  index: LogSearchIndex,
): LogNode[] {
  return nodes.flatMap((node): LogNode[] => {
    const matches = index.textBySeq.get(node.seq)?.includes(query) ?? false;
    if (node.kind !== 'group') return matches ? [node] : [];

    const children = matches ? node.children : filterLogNodesInternal(node.children, query, index);
    if (!matches && children.length === 0) return [];

    return [
      {
        ...node,
        children,
        lineCount: matches ? node.lineCount : countOutputLines(children),
      },
    ];
  });
}

function indexNodes(nodes: readonly LogNode[], textBySeq: Map<number, string>): void {
  for (const node of nodes) {
    textBySeq.set(node.seq, searchableNodeText(node).toLocaleLowerCase());
    if (node.kind === 'group') indexNodes(node.children, textBySeq);
  }
}

function searchableNodeText(node: LogNode): string {
  switch (node.kind) {
    case 'output':
      return stripAnsi(stripTrailingNewline(node.record.data));
    case 'group':
      return node.record.name;
    case 'marker':
      return markerText(node.record.type);
    case 'session':
      return sessionRowText(node.record.row);
    default:
      return assertNever(node);
  }
}

function markerText(type: 'end' | 'gap' | 'capped' | 'runner_lost'): string {
  switch (type) {
    case 'end':
      return 'End of log';
    case 'gap':
      return 'Output missing';
    case 'capped':
      return 'Log size limit reached';
    case 'runner_lost':
      return 'Runner disconnected';
    default:
      return assertNever(type);
  }
}

function sessionRowText(row: SessionViewRow): string {
  switch (row.kind) {
    case 'message':
      return stripAnsi(
        [row.label, row.text, ...row.meta.flatMap((meta) => [meta.label, meta.value])].join(' '),
      );
    case 'thinking':
      return stripAnsi(['thinking', row.text].join(' '));
    case 'tool-call':
      return stripAnsi(['tool', row.name, row.summary, row.input].filter(Boolean).join(' '));
    case 'tool-result':
      return stripAnsi(
        ['result', row.toolName, row.output, row.isError ? 'error' : 'ok'].join(' '),
      );
    case 'lifecycle':
      return stripAnsi(
        [row.label, row.detail, ...row.meta.flatMap((meta) => [meta.label, meta.value])]
          .filter(Boolean)
          .join(' '),
      );
    case 'raw':
      return stripAnsi([row.label, row.raw].join(' '));
    default:
      return assertNever(row);
  }
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_SGR_SEQUENCE, '');
}

function countOutputLines(nodes: readonly LogNode[]): number {
  return nodes.reduce((count, node) => {
    if (node.kind === 'output') return count + 1;
    if (node.kind === 'group') return count + node.lineCount;
    return count;
  }, 0);
}
