import type {LogRecord} from './log-model.js';

/**
 * Pure render transform for the step-log read stream. The runner emits a flat,
 * ordered NDJSON record list; `group_start`/`group_end` form a tree that the
 * reader reconstructs here before rendering. No React, no state: one function
 * over the record array.
 *
 *   records[] ──▶ buildLogTree ──▶ { nodes (forest), terminated, originTs, lineCount }
 *
 * Group closing matches `group_id` (not a blind top-of-stack pop) so a stream that
 * drops a `group_start` under backlog/gap pressure but still delivers its
 * `group_end` does not mis-nest everything after it.
 */

export type OutputLogRecord = Extract<LogRecord, {type: 'output'}>;
export type GroupStartLogRecord = Extract<LogRecord, {type: 'group_start'}>;
export type EndLogRecord = Extract<LogRecord, {type: 'end'}>;
export type GapLogRecord = Extract<LogRecord, {type: 'gap'}>;
export type CappedLogRecord = Extract<LogRecord, {type: 'capped'}>;
export type RunnerLostLogRecord = Extract<LogRecord, {type: 'runner_lost'}>;
export type AgentSessionLogRecord = Extract<LogRecord, {type: 'agent_session'}>;
export type MarkerLogRecord = EndLogRecord | GapLogRecord | CappedLogRecord | RunnerLostLogRecord;

/**
 * Stable, unique render key in creation order. A natural key is not enough: `group_id`
 * and a marker's `(type, ts)` can both repeat among siblings once a consumer feeds a
 * concatenated multi-step/retry stream (or two markers land in the same millisecond),
 * and the append-only build order keeps `seq` stable across re-renders.
 */
export interface LogNodeBase {
  seq: number;
}

export interface OutputLogNode extends LogNodeBase {
  kind: 'output';
  lineNumber: number;
  record: OutputLogRecord;
}

export interface MarkerLogNode extends LogNodeBase {
  kind: 'marker';
  record: MarkerLogRecord;
}

export interface GroupLogNode extends LogNodeBase {
  kind: 'group';
  record: GroupStartLogRecord;
  /** False when no matching `group_end` arrived (still streaming, or truncated). */
  closed: boolean;
  /** `group_end` timestamp when closed by its matching end, else null. */
  endTs: number | null;
  /** Precomputed: subtree contains a `runner_lost` (a genuine failure). `stderr` is a channel, not an error, so it never sets this. */
  hasError: boolean;
  /** Precomputed output-line count in the subtree, for the collapsed summary. */
  lineCount: number;
  children: LogNode[];
}

export interface SessionLogNode extends LogNodeBase {
  kind: 'session';
  record: AgentSessionLogRecord;
}

export type LogNode = OutputLogNode | MarkerLogNode | GroupLogNode | SessionLogNode;

export interface LogTree {
  nodes: LogNode[];
  /** The stream is closed: the records contain an `end` or a `runner_lost`. */
  terminated: boolean;
  /** First record's timestamp; the baseline for relative timestamps. Null when empty. */
  originTs: number | null;
  /** Physical output lines (one per `output` record in v1); drives the end banner. */
  lineCount: number;
}

const TRAILING_NEWLINE = /\r?\n$/;

/** Strips a single trailing line ending (CRLF or LF) so a line-framed record renders without a blank continuation. */
export function stripTrailingNewline(data: string): string {
  return data.replace(TRAILING_NEWLINE, '');
}

export function assertNever(value: never): never {
  throw new Error(`unexpected log record type: ${JSON.stringify(value)}`);
}

export function buildLogTree(records: readonly LogRecord[]): LogTree {
  const nodes: LogNode[] = [];
  const stack: GroupLogNode[] = [];
  let seq = 0;
  let lineNumber = 0;
  let lineCount = 0;
  let terminated = false;
  let originTs: number | null = null;

  const childrenOf = (): LogNode[] => stack[stack.length - 1]?.children ?? nodes;

  // Bubble a failure signal (a runner_lost only) to every currently-open ancestor group
  // in one pass, so `hasError` is read in O(1) at render time instead of re-walking subtrees.
  const markOpenGroupsError = (): void => {
    for (const frame of stack) frame.hasError = true;
  };

  for (const record of records) {
    if (originTs === null) originTs = record.ts;
    switch (record.type) {
      case 'output': {
        lineNumber += 1;
        lineCount += 1;
        for (const frame of stack) frame.lineCount += 1;
        childrenOf().push({kind: 'output', seq: seq++, lineNumber, record});
        break;
      }
      case 'group_start': {
        // Reconcile the open stack to the declared parent before nesting. `parent_group_id`
        // is the runner's stack top at emit time (null at the root), so any reader frame
        // below that parent (or every open frame, when the parent is root) is a group whose
        // own `group_end` was dropped under backlog pressure. Orphan-close those frames so a
        // dropped end never mis-parents the groups that follow. A parent whose own start was
        // dropped is not on the stack: it falls through to best-effort root placement.
        const parentId = record.parentGroupId;
        let parentIndex = -1;
        if (parentId !== null) {
          for (let i = stack.length - 1; i >= 0; i -= 1) {
            if (stack[i]?.record.groupId === parentId) {
              parentIndex = i;
              break;
            }
          }
        }
        for (let i = stack.length - 1; i > parentIndex; i -= 1) {
          const frame = stack[i];
          if (frame) frame.closed = true;
        }
        stack.length = parentIndex + 1;

        const group: GroupLogNode = {
          kind: 'group',
          seq: seq++,
          record,
          closed: false,
          endTs: null,
          hasError: false,
          lineCount: 0,
          children: [],
        };
        childrenOf().push(group);
        stack.push(group);
        break;
      }
      case 'group_end': {
        // Close the matching open group_id; any inner frames orphaned by a dropped
        // group_end close with it. An end with no matching open start is ignored.
        let matchIndex = -1;
        for (let i = stack.length - 1; i >= 0; i -= 1) {
          if (stack[i]?.record.groupId === record.groupId) {
            matchIndex = i;
            break;
          }
        }
        if (matchIndex !== -1) {
          for (let i = stack.length - 1; i >= matchIndex; i -= 1) {
            const frame = stack[i];
            if (frame) frame.closed = true;
          }
          const matched = stack[matchIndex];
          if (matched) matched.endTs = record.ts;
          stack.length = matchIndex;
        }
        break;
      }
      case 'end':
      case 'gap':
      case 'capped': {
        if (record.type === 'end') terminated = true;
        childrenOf().push({kind: 'marker', seq: seq++, record});
        break;
      }
      case 'runner_lost': {
        terminated = true;
        childrenOf().push({kind: 'marker', seq: seq++, record});
        markOpenGroupsError();
        break;
      }
      case 'agent_session':
        childrenOf().push({kind: 'session', seq: seq++, record});
        break;
      default:
        assertNever(record);
    }
  }

  return {
    nodes,
    terminated,
    originTs,
    lineCount,
  };
}
