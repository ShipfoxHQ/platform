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
  const state: LogTreeBuildState = {
    nodes: [],
    stack: [],
    seq: 0,
    lineNumber: 0,
    lineCount: 0,
    terminated: false,
    originTs: null,
  };

  for (const record of records) {
    if (state.originTs === null) state.originTs = record.ts;
    appendLogRecord(state, record);
  }

  return {
    nodes: state.nodes,
    terminated: state.terminated,
    originTs: state.originTs,
    lineCount: state.lineCount,
  };
}

interface LogTreeBuildState {
  nodes: LogNode[];
  stack: GroupLogNode[];
  seq: number;
  lineNumber: number;
  lineCount: number;
  terminated: boolean;
  originTs: number | null;
}

function childrenOf(state: LogTreeBuildState): LogNode[] {
  return state.stack[state.stack.length - 1]?.children ?? state.nodes;
}

function appendLogRecord(state: LogTreeBuildState, record: LogRecord): void {
  switch (record.type) {
    case 'output':
      appendOutputRecord(state, record);
      return;
    case 'group_start':
      appendGroupStartRecord(state, record);
      return;
    case 'group_end':
      appendGroupEndRecord(state, record);
      return;
    case 'end':
    case 'gap':
    case 'capped':
      if (record.type === 'end') state.terminated = true;
      childrenOf(state).push({kind: 'marker', seq: state.seq++, record});
      return;
    case 'runner_lost':
      state.terminated = true;
      childrenOf(state).push({kind: 'marker', seq: state.seq++, record});
      for (const frame of state.stack) frame.hasError = true;
      return;
    case 'agent_session':
      childrenOf(state).push({kind: 'session', seq: state.seq++, record});
      return;
    default:
      assertNever(record);
  }
}

function appendOutputRecord(
  state: LogTreeBuildState,
  record: Extract<LogRecord, {type: 'output'}>,
): void {
  state.lineNumber += 1;
  state.lineCount += 1;
  for (const frame of state.stack) frame.lineCount += 1;
  childrenOf(state).push({kind: 'output', seq: state.seq++, lineNumber: state.lineNumber, record});
}

function appendGroupStartRecord(
  state: LogTreeBuildState,
  record: Extract<LogRecord, {type: 'group_start'}>,
): void {
  let parentIndex = -1;
  if (record.parentGroupId !== null) {
    parentIndex = findOpenGroupIndex(state.stack, record.parentGroupId);
  }
  for (let index = state.stack.length - 1; index > parentIndex; index -= 1) {
    const frame = state.stack[index];
    if (frame) frame.closed = true;
  }
  state.stack.length = parentIndex + 1;
  const group: GroupLogNode = {
    kind: 'group',
    seq: state.seq++,
    record,
    closed: false,
    endTs: null,
    hasError: false,
    lineCount: 0,
    children: [],
  };
  childrenOf(state).push(group);
  state.stack.push(group);
}

function appendGroupEndRecord(
  state: LogTreeBuildState,
  record: Extract<LogRecord, {type: 'group_end'}>,
): void {
  const matchIndex = findOpenGroupIndex(state.stack, record.groupId);
  if (matchIndex === -1) return;
  for (let index = state.stack.length - 1; index >= matchIndex; index -= 1) {
    const frame = state.stack[index];
    if (frame) frame.closed = true;
  }
  const matched = state.stack[matchIndex];
  if (matched) matched.endTs = record.ts;
  state.stack.length = matchIndex;
}

function findOpenGroupIndex(stack: readonly GroupLogNode[], groupId: string): number {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index]?.record.groupId === groupId) return index;
  }
  return -1;
}
