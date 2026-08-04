'use client';

import {Icon} from '@shipfox/react-ui/icon';
import {LogContent, LogRow, LogRows, type LogTimestampMode} from '@shipfox/react-ui/log';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {type ReactNode, type UIEventHandler, useEffect, useMemo, useRef} from 'react';
import type {LogRecord} from '#core/log-model.js';
import {
  assertNever,
  buildLogTree,
  type LogNode,
  type LogTree,
  type MarkerLogRecord,
} from '#core/log-tree.js';
import {AgentSessionRows} from './agent-session-rows.js';
import {LogGroup} from './log-group.js';
import {OutputLogRow} from './output-log-row.js';
import {CappedMarker, EndMarker, GapMarker, RunnerLostMarker} from './system-markers.js';

export interface LogViewProps {
  records: readonly LogRecord[];
  timestamps?: LogTimestampMode;
  wrap?: boolean;
  showLineNumbers?: boolean;
  emptyState?: 'complete' | 'pending';
  defaultGroupsOpen?: boolean;
  anchorToFailure?: boolean;
  className?: string | undefined;
  onScroll?: UIEventHandler<HTMLDivElement> | undefined;
}

export interface LogViewSkeletonProps
  extends Pick<LogViewProps, 'timestamps' | 'wrap' | 'showLineNumbers' | 'className'> {
  rows?: number;
}

export function LogView({
  records,
  timestamps = 'off',
  wrap = false,
  showLineNumbers = true,
  emptyState = 'complete',
  defaultGroupsOpen = false,
  anchorToFailure = false,
  className,
  onScroll,
}: LogViewProps) {
  const rowsRef = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => buildLogTree(records), [records]);
  const resolvedToolCalls = useMemo(() => collectResolvedToolCalls(tree.nodes), [tree.nodes]);
  const noOutputState = getNoOutputState(tree, emptyState);
  const anchorRecordCount = records.length;

  useEffect(() => {
    if (!anchorToFailure) return;
    if (anchorRecordCount === 0) return;

    const frame = scheduleAnimationFrame(() => {
      const rows = rowsRef.current;
      if (!rows) return;

      const failure = rows.querySelector<HTMLElement>('[data-log-terminal-failure="true"]');
      if (failure) {
        failure.scrollIntoView({block: 'center'});
        return;
      }

      rows.scrollTop = rows.scrollHeight;
    });

    return () => cancelScheduledFrame(frame);
  }, [anchorToFailure, anchorRecordCount]);

  return (
    <LogRows
      ref={rowsRef}
      timestamps={timestamps}
      wrap={wrap}
      showLineNumbers={showLineNumbers}
      className={className}
      onScroll={onScroll}
      {...(tree.originTs != null ? {timestampOrigin: new Date(tree.originTs)} : {})}
    >
      {noOutputState ? <NoOutputRow state={noOutputState} /> : null}
      {renderNodes(tree.nodes, 0, tree, defaultGroupsOpen, resolvedToolCalls)}
    </LogRows>
  );
}

export function LogViewSkeleton({
  rows = 5,
  timestamps = 'off',
  wrap = false,
  showLineNumbers = true,
  className,
}: LogViewSkeletonProps) {
  const widths = ['w-[62%]', 'w-[44%]', 'w-[74%]', 'w-[36%]', 'w-[55%]'];
  const skeletonRows = getSkeletonRows(rows);

  return (
    <LogRows
      timestamps={timestamps}
      wrap={wrap}
      showLineNumbers={showLineNumbers}
      className={className}
      role="presentation"
      aria-live="off"
      aria-hidden="true"
    >
      {skeletonRows.map((row) => (
        <LogRow key={row.id} lineNumber={row.lineNumber}>
          <Skeleton
            className={`my-[4px] h-12 ${widths[(row.lineNumber - 1) % widths.length] ?? 'w-[48%]'}`}
          />
        </LogRow>
      ))}
    </LogRows>
  );
}

function getSkeletonRows(rows: number): {id: string; lineNumber: number}[] {
  return Array.from({length: rows}, (_, index) => {
    const lineNumber = index + 1;
    return {id: `log-view-skeleton-row-${lineNumber}`, lineNumber};
  });
}

function getNoOutputState(
  tree: LogTree,
  emptyState: NonNullable<LogViewProps['emptyState']>,
): LogViewProps['emptyState'] | null {
  if (tree.nodes.length === 0) return emptyState;

  if (tree.lineCount !== 0) return null;
  if (tree.nodes.length !== 1) return null;

  const [node] = tree.nodes;
  if (node?.kind === 'marker' && node.record.type === 'end') return 'complete';

  return null;
}

function NoOutputRow({state}: {state: NonNullable<LogViewProps['emptyState']>}) {
  const copy =
    state === 'pending'
      ? {
          title: 'No output yet',
          detail: 'New lines will appear here as the step writes them.',
        }
      : {
          title: 'Step produced no output',
          detail: 'This log stream closed without session entries or process output.',
        };

  return (
    <LogRow lineNumber={null}>
      <LogContent className="text-foreground-neutral-muted">
        <span className="inline-flex min-w-0 items-center gap-inline">
          <Icon name="info" className="size-14 flex-none" aria-hidden="true" />
          <span className="min-w-0">
            <span className="font-medium">{copy.title}</span>
            {' · '}
            <span className="text-foreground-neutral-subtle">{copy.detail}</span>
          </span>
        </span>
      </LogContent>
    </LogRow>
  );
}

function renderNodes(
  nodes: readonly LogNode[],
  depth: number,
  tree: LogTree,
  defaultGroupsOpen: boolean,
  resolvedToolCalls: ResolvedToolCalls,
): ReactNode[] {
  // `node.seq` is the stable, unique render key (see `LogNodeBase`): a concatenated
  // multi-step/retry stream can repeat a `group_id` or a marker's `(type, ts)` at one
  // level, which a key derived from those fields would collide on.
  return nodes.map((node): ReactNode => {
    switch (node.kind) {
      case 'output':
        return (
          <OutputLogRow
            key={node.seq}
            record={node.record}
            lineNumber={node.lineNumber}
            indent={depth}
          />
        );
      case 'group':
        return (
          <LogGroup
            key={node.seq}
            node={node}
            depth={depth}
            terminated={tree.terminated}
            defaultOpen={defaultGroupsOpen}
          >
            {renderNodes(node.children, depth + 1, tree, defaultGroupsOpen, resolvedToolCalls)}
          </LogGroup>
        );
      case 'marker':
        return <MarkerRow key={node.seq} record={node.record} tree={tree} />;
      case 'session':
        return (
          <AgentSessionRows
            key={node.seq}
            rows={[node.record.row]}
            resolvedToolCallIds={resolvedToolCalls.ids}
            toolCallNames={resolvedToolCalls.names}
            indent={depth}
          />
        );
      default:
        return assertNever(node);
    }
  });
}

interface ResolvedToolCalls {
  ids: ReadonlySet<string>;
  names: ReadonlyMap<string, string>;
}

function collectResolvedToolCalls(nodes: readonly LogNode[]): ResolvedToolCalls {
  const ids = new Set<string>();
  const names = new Map<string, string>();
  collectResolvedToolCallsInto(nodes, ids, names);
  return {ids, names};
}

function collectResolvedToolCallsInto(
  nodes: readonly LogNode[],
  ids: Set<string>,
  names: Map<string, string>,
): void {
  for (const node of nodes) {
    switch (node.kind) {
      case 'session':
        if (node.record.row.kind === 'tool-call' && node.record.row.id != null) {
          names.set(node.record.row.id, node.record.row.name);
        } else if (node.record.row.kind === 'tool-result' && node.record.row.toolCallId != null) {
          ids.add(node.record.row.toolCallId);
        }
        break;
      case 'group':
        collectResolvedToolCallsInto(node.children, ids, names);
        break;
      case 'output':
      case 'marker':
        break;
      default:
        assertNever(node);
    }
  }
}

function scheduleAnimationFrame(callback: FrameRequestCallback): number {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(Date.now()), 0);
}

function cancelScheduledFrame(frame: number) {
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(frame);
    return;
  }
  window.clearTimeout(frame);
}

function MarkerRow({record, tree}: {record: MarkerLogRecord; tree: LogTree}): ReactNode {
  switch (record.type) {
    case 'end':
      return (
        <EndMarker
          record={record}
          lineCount={tree.lineCount}
          durationMs={tree.originTs != null ? record.ts - tree.originTs : null}
        />
      );
    case 'gap':
      return <GapMarker record={record} />;
    case 'capped':
      return <CappedMarker record={record} />;
    case 'runner_lost':
      return <RunnerLostMarker record={record} />;
    default:
      return assertNever(record);
  }
}
