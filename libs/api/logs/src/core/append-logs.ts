import {Buffer} from 'node:buffer';
import {
  type LogRecord,
  parseLogRecordLine,
  parseRawLogRecordLine,
  type RawLogRecord,
  type SessionViewLifecycleRow,
  type SessionViewRow,
} from '@shipfox/api-logs-dto';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import {DEFAULT_HARNESS, type Harness} from '@shipfox/workflow-document';
import {config} from '#config.js';
import {isJobCapped} from '#db/accounting.js';
import {getStreamWriterOrigin} from '#db/chunks.js';
import {db, type Transaction} from '#db/db.js';
import {
  casExtendCommittedLength,
  getOrCreateAttemptStreamWithStatus,
  setClaudeParseContext,
} from '#db/streams.js';
import {
  bytesIngestedCount,
  bytesStoredCount,
  type LogRecordMetricKind,
  recordAppendedCount,
  streamClosedCount,
  streamOpenedCount,
} from '#metrics/instance.js';
import {
  type AppendIdentity,
  type AppendLogsResult,
  readHeartbeat,
  storeChunk,
} from './append-chunk.js';
import {closeStream} from './close-stream.js';
import {LogWriterConflictError, MalformedLogChunkError, OffsetGapError} from './errors.js';
import {flushPendingToolRows} from './session/claude/rows.js';
import {
  type ClaudeParseContext,
  claudeInitSessionId,
  createClaudeParseContext,
} from './session/claude-parser.js';
import type {SessionParseContext} from './session/parse-session.js';
import {parseSessionRecord} from './session/parse-session.js';
import type {AgentSessionRecord} from './session/session-record.js';

export interface AppendLogsParams extends AppendIdentity {
  offset: number;
  body: Buffer;
}

interface AppendLogsMetrics {
  readonly recordCounts: Partial<Record<LogRecordMetricKind, number>>;
  streamClosedReason: 'declared' | undefined;
  streamOpened: boolean;
  ingestedBytes: number;
  storedBytes: number;
}

export type {AppendLogsResult} from './append-chunk.js';

interface ParsedBody {
  declaredTotalBytes?: number;
  records: RawLogRecord[];
  hasAgentSessionRecord: boolean;
}

/**
 * Pure pre-transaction parse. Requires whole, newline-terminated lines so
 * `committed_length` always lands on a line boundary (one body = one chunk = whole
 * lines; no line ever spans two chunks). Runs before any lock is taken, so a
 * malformed or large body never holds a row. The offset CAS uses the raw append byte length; the
 * budget charges the normalized body built from these parsed records.
 *
 * Each line is validated against the raw record union (a forged server-only
 * `capped`/`runner_lost` fails here); the declared total is pulled from an `end`
 * record. A line that is a valid server-only record under the read union surfaces
 * its type via `forgedType` for the narrowed audit warn.
 */
function parseAppendBody(body: Buffer): ParsedBody {
  if (body.length === 0) return {records: [], hasAgentSessionRecord: false};

  const text = body.toString('utf8');
  if (!text.endsWith('\n')) {
    throw new MalformedLogChunkError('append body must end with a newline (whole records only)');
  }
  const lines = text.split('\n');
  lines.pop();

  let declaredTotalBytes: number | undefined;
  const records: RawLogRecord[] = [];
  let hasAgentSessionRecord = false;
  for (const line of lines) {
    let record: ReturnType<typeof parseRawLogRecordLine>;
    try {
      record = parseRawLogRecordLine(line);
    } catch {
      throw new MalformedLogChunkError(
        'append body contains an invalid NDJSON record',
        detectForgedType(line),
      );
    }
    records.push(record);
    if (record.type === 'end') {
      declaredTotalBytes = record.total_bytes;
    }
    // An agent_session line is one whole entry in one record; bound its size here (the DTO
    // schema leaves `data` uncapped because it cannot read this runtime config). An over-cap
    // line is rejected so a single entry can never blow the request body or the spool window.
    if (
      record.type === 'agent_session' &&
      Buffer.byteLength(line, 'utf8') > config.LOG_MAX_SESSION_LINE_BYTES
    ) {
      throw new MalformedLogChunkError(
        `agent_session line exceeds ${config.LOG_MAX_SESSION_LINE_BYTES} bytes`,
      );
    }
    if (record.type === 'agent_session') {
      hasAgentSessionRecord = true;
    }
  }

  return declaredTotalBytes === undefined
    ? {records, hasAgentSessionRecord}
    : {declaredTotalBytes, records, hasAgentSessionRecord};
}

/**
 * A line that fails the raw write union but is a valid record under the read union
 * can only be a server-only `capped`/`runner_lost` tombstone: i.e. a forgery
 * attempt. Returns its type for the audit warn, or undefined for plain garbage.
 */
function detectForgedType(line: string): string | undefined {
  try {
    return parseLogRecordLine(line).type;
  } catch {
    return undefined;
  }
}

async function getSessionHarness(
  workflows: WorkflowsModuleClient | undefined,
  stepId: string,
): Promise<Harness> {
  return workflows ? (await workflows.getStepLogContext({stepId})).harness : DEFAULT_HARNESS;
}

interface StoredBody {
  body: Buffer;
  recordCounts: Partial<Record<LogRecord['type'], number>>;
  claudeParseContext: ClaudeParseContext | undefined;
  claudePendingResult: SessionViewLifecycleRow | null | undefined;
  claudePendingToolRows: readonly SessionViewRow[] | undefined;
}

interface StoredBodyBuildState {
  readonly storedRecords: LogRecord[];
  readonly parseContext: SessionParseContext | undefined;
  readonly latestClaudeInitIndicesBySessionId: ReadonlyMap<string, number> | undefined;
  readonly harness: Harness;
  readonly isStreamFinal: boolean;
  pendingResult: SessionViewLifecycleRow | null;
}

function buildStoredBody(
  records: readonly RawLogRecord[],
  harness: Harness,
  initialClaudeParseContext?: ClaudeParseContext,
  initialClaudePendingResult?: SessionViewLifecycleRow | null,
  isStreamFinal = false,
): StoredBody {
  const parseContext: SessionParseContext | undefined =
    harness === 'claude'
      ? {
          claude: initialClaudeParseContext ?? createClaudeParseContext(),
          isFinalResult: true,
        }
      : undefined;
  const state: StoredBodyBuildState = {
    storedRecords: [],
    parseContext,
    latestClaudeInitIndicesBySessionId:
      harness === 'claude' ? latestClaudeInitIndices(records) : undefined,
    harness,
    isStreamFinal,
    pendingResult: initialClaudePendingResult ?? null,
  };
  appendPendingClaudeResult(records, state);

  for (const [index, record] of records.entries()) {
    appendStoredRecord(record, index, state);
  }

  appendPendingClaudeToolRows(state);

  const body = Buffer.from(
    state.storedRecords.map((record) => `${JSON.stringify(record)}\n`).join(''),
  );

  return {
    body,
    recordCounts: countStoredRecords(state.storedRecords),
    claudeParseContext: parseContext?.claude,
    claudePendingResult: parseContext?.claude === undefined ? undefined : state.pendingResult,
    claudePendingToolRows: parseContext?.claude?.pendingToolRows,
  };
}

function appendPendingClaudeResult(
  records: readonly RawLogRecord[],
  state: StoredBodyBuildState,
): void {
  const claude = state.parseContext?.claude;
  if (claude === undefined || state.pendingResult === null) return;
  const firstInit = firstClaudeInit(records);
  if (!state.isStreamFinal && !firstInit.hasInit) return;
  state.storedRecords.push(
    storedAgentSessionRow(
      finalizePendingResult(
        state.pendingResult,
        firstInit.sessionId !== undefined && firstInit.sessionId === claude.sessionId,
        claude.turn,
      ),
    ),
  );
  state.pendingResult = null;
}

function appendStoredRecord(
  record: RawLogRecord,
  index: number,
  state: StoredBodyBuildState,
): void {
  if (record.type !== 'agent_session') {
    state.storedRecords.push(record);
    return;
  }
  updateClaudeFinalResult(index, state);
  for (const row of parseSessionRecord(
    agentSessionRecord(record),
    state.harness,
    state.parseContext,
  )) {
    appendParsedSessionRow(row, state);
  }
}

function updateClaudeFinalResult(index: number, state: StoredBodyBuildState): void {
  const parseContext = state.parseContext;
  if (parseContext?.claude === undefined || state.latestClaudeInitIndicesBySessionId === undefined)
    return;
  parseContext.isFinalResult = !hasFutureClaudeInit(
    state.latestClaudeInitIndicesBySessionId,
    index,
    parseContext.claude.sessionId,
  );
}

function appendParsedSessionRow(row: SessionViewRow, state: StoredBodyBuildState): void {
  if (
    state.parseContext?.claude !== undefined &&
    !state.isStreamFinal &&
    isClaudeFinalResultRow(row)
  ) {
    if (state.pendingResult !== null) {
      state.storedRecords.push(storedAgentSessionRow(state.pendingResult));
    }
    state.pendingResult = row;
    return;
  }
  state.storedRecords.push(storedAgentSessionRow(row));
}

function appendPendingClaudeToolRows(state: StoredBodyBuildState): void {
  const claude = state.parseContext?.claude;
  if (!state.isStreamFinal || claude === undefined) return;
  for (const row of flushPendingToolRows(claude)) {
    state.storedRecords.push(storedAgentSessionRow(row));
  }
}

function countStoredRecords(
  records: readonly LogRecord[],
): Partial<Record<LogRecord['type'], number>> {
  const recordCounts: Partial<Record<LogRecord['type'], number>> = {};
  for (const record of records) {
    recordCounts[record.type] = (recordCounts[record.type] ?? 0) + 1;
  }
  return recordCounts;
}

function storedAgentSessionRow(row: SessionViewRow): LogRecord {
  return {v: 1, ts: row.timestamp, type: 'agent_session', row};
}

function isClaudeFinalResultRow(row: SessionViewRow): row is SessionViewLifecycleRow {
  return row.kind === 'lifecycle' && row.label === 'Session completed';
}

function finalizePendingResult(
  row: SessionViewLifecycleRow,
  sameSession: boolean,
  turn: number,
): SessionViewLifecycleRow {
  if (!sameSession) return row;

  return {
    ...row,
    label: `Turn ${turn} completed`,
    meta: [{label: 'turn', value: String(turn)}, ...row.meta],
  };
}

function firstClaudeInit(records: readonly RawLogRecord[]): {
  hasInit: boolean;
  sessionId: string | undefined;
} {
  for (const record of records) {
    if (record.type !== 'agent_session') continue;
    const sessionRecord = agentSessionRecord(record);
    const sessionId = claudeInitSessionId(sessionRecord);
    if (sessionId !== undefined) return {hasInit: true, sessionId};
  }

  return {hasInit: false, sessionId: undefined};
}

function latestClaudeInitIndices(records: readonly RawLogRecord[]): Map<string, number> {
  const latestIndices = new Map<string, number>();

  for (const [index, record] of records.entries()) {
    if (record.type !== 'agent_session') continue;

    const sessionId = claudeInitSessionId(agentSessionRecord(record));
    if (sessionId !== undefined) latestIndices.set(sessionId, index);
  }

  return latestIndices;
}

function hasFutureClaudeInit(
  latestClaudeInitIndicesBySessionId: ReadonlyMap<string, number>,
  currentIndex: number,
  sessionId: string | null,
): boolean {
  if (sessionId === null) return false;

  return (latestClaudeInitIndicesBySessionId.get(sessionId) ?? -1) > currentIndex;
}

function agentSessionRecord(
  record: Extract<RawLogRecord, {type: 'agent_session'}>,
): AgentSessionRecord {
  return {data: record.data, ts: record.ts};
}

/**
 * Concurrency is serialized through Postgres row locks taken implicitly by the
 * conditional UPDATEs, not an explicit `SELECT ... FOR UPDATE`. Appends for one
 * job contend on its single accounting row, so the path is multi-instance safe
 * but not lock-free.
 */
export async function appendLogs(
  params: AppendLogsParams,
  workflows?: WorkflowsModuleClient,
): Promise<AppendLogsResult> {
  let parsed: ParsedBody;
  try {
    parsed = parseAppendBody(params.body);
  } catch (error) {
    // Narrowed audit: only the detectable forgery case, never the payload or a token.
    if (error instanceof MalformedLogChunkError && error.forgedType !== undefined) {
      logger().warn(
        {
          jobId: params.jobId,
          stepId: params.stepId,
          offendingType: error.forgedType,
        },
        'Rejected forged server-only log record on append',
      );
    }
    throw error;
  }
  const sessionHarness = parsed.hasAgentSessionRecord
    ? await getSessionHarness(workflows, params.stepId)
    : DEFAULT_HARNESS;
  const metrics = {
    recordCounts: {} as Partial<Record<LogRecordMetricKind, number>>,
    streamClosedReason: undefined as 'declared' | undefined,
    streamOpened: false,
    // Raw runner body bytes accepted by the in-order CAS; normalized durable bytes written
    // to chunk rows. Both are accumulated inside the transaction and recorded only after it
    // commits, so a rolled-back append never counts. See the semantics on the metric
    // definitions in `#metrics/instance.js`.
    ingestedBytes: 0,
    storedBytes: 0,
  };

  const result = await db().transaction((tx) =>
    appendLogsTransaction(tx, params, parsed, sessionHarness, metrics),
  );

  if (metrics.streamOpened) streamOpenedCount.add(1);
  if (metrics.ingestedBytes > 0) bytesIngestedCount.add(metrics.ingestedBytes);
  if (metrics.storedBytes > 0) bytesStoredCount.add(metrics.storedBytes);
  for (const [kind, count] of Object.entries(metrics.recordCounts)) {
    if (count > 0) recordAppendedCount.add(count, {kind: kind as LogRecordMetricKind});
  }
  if (metrics.streamClosedReason) {
    streamClosedCount.add(1, {reason: metrics.streamClosedReason});
  }

  return result;
}

type AppendStream = Awaited<ReturnType<typeof getOrCreateAttemptStreamWithStatus>>['stream'];

async function appendLogsTransaction(
  tx: Transaction,
  params: AppendLogsParams,
  parsed: ParsedBody,
  sessionHarness: Harness,
  metrics: AppendLogsMetrics,
): Promise<AppendLogsResult> {
  const commitByteLen = params.body.length;
  if (commitByteLen === 0) return readHeartbeat(tx, params);
  const {created, stream} = await getOrCreateAttemptStreamWithStatus(tx, params);
  metrics.streamOpened = created;
  // Closed streams accept-and-drop late chunks and keep their final cursor.
  if (stream.state === 'closed') return closedAppendResult(tx, stream, params.jobId);
  if ((await getStreamWriterOrigin(tx, stream.id)) === 'server') {
    throw new LogWriterConflictError('server');
  }

  const cas = await casExtendCommittedLength(tx, {
    streamId: stream.id,
    offset: params.offset,
    byteLen: commitByteLen,
  });
  if (cas.outcome === 'gap') throw new OffsetGapError(cas.committedLength);
  if (cas.outcome === 'retry') {
    return {committedLength: cas.committedLength, capped: await isJobCapped(tx, params.jobId)};
  }
  metrics.ingestedBytes += commitByteLen;
  return storeRunnerAppend(
    tx,
    params,
    parsed,
    sessionHarness,
    stream,
    cas.committedLength,
    metrics,
  );
}

async function closedAppendResult(
  tx: Transaction,
  stream: AppendStream,
  jobId: string,
): Promise<AppendLogsResult> {
  return {committedLength: stream.committedLength, capped: await isJobCapped(tx, jobId)};
}

async function storeRunnerAppend(
  tx: Transaction,
  params: AppendLogsParams,
  parsed: ParsedBody,
  sessionHarness: Harness,
  stream: AppendStream,
  committedLength: number,
  metrics: AppendLogsMetrics,
): Promise<AppendLogsResult> {
  const parseHarness = runnerParseHarness(sessionHarness, stream);
  const stored = runnerStoredBody(parsed, parseHarness, stream);
  const {
    recordCounts,
    stored: chunkStored,
    ...result
  } = await storeChunk(tx, {
    params,
    streamId: stream.id,
    streamOffset: params.offset,
    body: stored.body,
    committedLength,
    declaredTotalBytes: parsed.declaredTotalBytes,
    origin: 'runner',
  });
  recordStoredRunnerChunk(stored, chunkStored, recordCounts, metrics);
  await persistClaudeParseContext(tx, stream.id, stored, chunkStored, result.capped);
  await closeDeclaredRunnerStream(tx, stream.id, parsed.declaredTotalBytes, chunkStored, metrics);
  return result;
}

function runnerParseHarness(sessionHarness: Harness, stream: AppendStream): Harness {
  if (sessionHarness === 'claude') return 'claude';
  if (stream.claudePendingResult !== null || stream.claudePendingToolRows.length > 0)
    return 'claude';
  return sessionHarness;
}

function runnerStoredBody(
  parsed: ParsedBody,
  parseHarness: Harness,
  stream: AppendStream,
): StoredBody {
  const context =
    parseHarness === 'claude'
      ? createClaudeParseContext(stream.claudePendingToolRows, {
          hasInit: stream.claudeHasInit,
          sessionId: stream.claudeSessionId,
          turn: stream.claudeTurn,
        })
      : undefined;
  return buildStoredBody(
    parsed.records,
    parseHarness,
    context,
    parseHarness === 'claude' ? stream.claudePendingResult : undefined,
    parsed.declaredTotalBytes !== undefined,
  );
}

function recordStoredRunnerChunk(
  stored: StoredBody,
  chunkStored: boolean,
  chunkRecordCounts: Partial<Record<LogRecordMetricKind, number>>,
  metrics: AppendLogsMetrics,
): void {
  if (chunkStored) {
    metrics.storedBytes += stored.body.length;
    addRecordCounts(metrics.recordCounts, stored.recordCounts);
  }
  addRecordCounts(metrics.recordCounts, chunkRecordCounts);
}

async function persistClaudeParseContext(
  tx: Transaction,
  streamId: string,
  stored: StoredBody,
  chunkStored: boolean,
  capped: boolean,
): Promise<void> {
  if (stored.claudeParseContext === undefined) return;
  if (!chunkStored && (stored.body.length > 0 || capped)) return;
  await setClaudeParseContext(tx, {
    streamId,
    hasInit: stored.claudeParseContext.hasInit,
    sessionId: stored.claudeParseContext.sessionId,
    turn: stored.claudeParseContext.turn,
    pendingResult: stored.claudePendingResult ?? null,
    pendingToolRows: stored.claudePendingToolRows ?? [],
  });
}

async function closeDeclaredRunnerStream(
  tx: Transaction,
  streamId: string,
  declaredTotalBytes: number | undefined,
  chunkStored: boolean,
  metrics: AppendLogsMetrics,
): Promise<void> {
  if (declaredTotalBytes === undefined || !chunkStored) return;
  const closed = await closeStream(tx, {streamId, reason: 'declared'});
  if (closed) metrics.streamClosedReason = 'declared';
}

function addRecordCounts(
  target: Partial<Record<LogRecordMetricKind, number>>,
  source: Partial<Record<LogRecordMetricKind, number>>,
): void {
  for (const [kind, count] of Object.entries(source)) {
    target[kind as LogRecordMetricKind] = (target[kind as LogRecordMetricKind] ?? 0) + (count ?? 0);
  }
}
