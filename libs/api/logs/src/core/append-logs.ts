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
import {accrueStoredBytes, claimCap, ensureJobAccounting, isJobCapped} from '#db/accounting.js';
import {insertChunk} from '#db/chunks.js';
import {db, type Transaction} from '#db/db.js';
import {
  casExtendCommittedLength,
  getAttemptStream,
  getOrCreateAttemptStreamWithStatus,
  setClaudeParseContext,
  setDeclaredTotalBytes,
} from '#db/streams.js';
import {
  type LogRecordMetricKind,
  recordAppendedCount,
  streamClosedCount,
  streamOpenedCount,
} from '#metrics/instance.js';
import {allowedBudget} from './budget.js';
import {closeStream, controlTombstone} from './close-stream.js';
import {MalformedLogChunkError, OffsetGapError} from './errors.js';
import {flushPendingToolRows} from './session/claude/rows.js';
import {
  type ClaudeParseContext,
  claudeInitSessionId,
  createClaudeParseContext,
} from './session/claude-parser.js';
import type {SessionParseContext} from './session/parse-session.js';
import {parseSessionRecord} from './session/parse-session.js';
import type {AgentSessionRecord} from './session/session-record.js';

export interface AppendLogsParams {
  jobId: string;
  workspaceId: string;
  projectId: string;
  workflowRunAttemptId: string;
  stepId: string;
  attempt: number;
  offset: number;
  body: Buffer;
}

export interface AppendLogsResult {
  committedLength: number;
  capped: boolean;
}

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
 * can only be a server-only `capped`/`runner_lost` tombstone — i.e. a forgery
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

/**
 * Empty-body heartbeat: report the current committed length without materializing
 * a stream, so a runner cannot mint unbounded rows with empty appends.
 */
async function readHeartbeat(tx: Transaction, params: AppendLogsParams): Promise<AppendLogsResult> {
  const existing = await getAttemptStream(tx, {
    jobId: params.jobId,
    stepId: params.stepId,
    attempt: params.attempt,
  });
  return {
    committedLength: existing?.committedLength ?? 0,
    capped: await isJobCapped(tx, params.jobId),
  };
}

interface StoreChunkParams {
  params: AppendLogsParams;
  streamId: string;
  body: Buffer;
  committedLength: number;
  declaredTotalBytes: number | undefined;
}

interface StoreChunkResult extends AppendLogsResult {
  /**
   * Whether the runner chunk was persisted. False only when the job was already
   * capped and the body (including any `end` record) was dropped, so the stream is
   * not whole and must not be declared-closed.
   */
  stored: boolean;
  recordCounts: Partial<Record<LogRecord['type'], number>>;
}

interface StoredBody {
  body: Buffer;
  recordCounts: Partial<Record<LogRecord['type'], number>>;
  claudeParseContext: ClaudeParseContext | undefined;
  claudePendingResult: SessionViewLifecycleRow | null | undefined;
  claudePendingToolRows: readonly SessionViewRow[] | undefined;
}

/**
 * Accrues the stored bytes, persists the chunk, and trips the per-job cap when
 * this append crosses the budget. Runs only after the offset-CAS extended
 * `committed_length`, so the committed length already reflects the accepted bytes.
 */
async function storeChunk(
  tx: Transaction,
  {params, streamId, body, committedLength, declaredTotalBytes}: StoreChunkParams,
): Promise<StoreChunkResult> {
  await ensureJobAccounting(tx, {jobId: params.jobId, workspaceId: params.workspaceId});
  const storedByteLen = body.length;
  const accrued = await accrueStoredBytes(tx, {jobId: params.jobId, delta: storedByteLen});

  // Already capped: accept-and-drop. committed_length has advanced so the runner
  // drains its spool cleanly instead of retry-looping; nothing is stored.
  if (!accrued) return {committedLength, capped: true, stored: false, recordCounts: {}};

  await insertChunk(tx, {
    streamId,
    streamOffset: params.offset,
    byteLen: storedByteLen,
    data: body,
    origin: 'runner',
  });
  if (declaredTotalBytes !== undefined) {
    await setDeclaredTotalBytes(tx, {streamId, declaredTotalBytes});
  }

  const allowed = allowedBudget({
    baseBytes: config.LOG_BUDGET_BASE_BYTES,
    ratePerMinuteBytes: config.LOG_BUDGET_RATE_BYTES_PER_MINUTE,
    elapsedMs: Date.now() - accrued.startedAt.getTime(),
  });
  if (accrued.used <= allowed) {
    return {committedLength, capped: false, stored: true, recordCounts: {}};
  }

  // Over budget. No hard ceiling: this crossing append is stored in full (overshoot
  // bounded by one body). Claim the cap once and inject an in-band `capped` tombstone
  // for the winner.
  const won = await claimCap(tx, params.jobId);
  if (won) {
    const tombstone = controlTombstone('capped');
    await insertChunk(tx, {
      streamId,
      streamOffset: committedLength,
      byteLen: tombstone.length,
      data: tombstone,
      origin: 'control',
    });
  }
  return {
    committedLength,
    capped: true,
    stored: true,
    recordCounts: won ? {capped: 1} : {},
  };
}

function buildStoredBody(
  records: readonly RawLogRecord[],
  harness: Harness,
  initialClaudeParseContext?: ClaudeParseContext,
  initialClaudePendingResult?: SessionViewLifecycleRow | null,
  isStreamFinal = false,
): StoredBody {
  const storedRecords: LogRecord[] = [];
  const parseContext: SessionParseContext | undefined =
    harness === 'claude'
      ? {
          claude: initialClaudeParseContext ?? createClaudeParseContext(),
          isFinalResult: true,
        }
      : undefined;
  const latestClaudeInitIndicesBySessionId =
    harness === 'claude' ? latestClaudeInitIndices(records) : undefined;
  let pendingResult = initialClaudePendingResult ?? null;

  if (parseContext?.claude !== undefined && pendingResult !== null) {
    const firstInit = firstClaudeInit(records);
    if (isStreamFinal || firstInit.hasInit) {
      storedRecords.push(
        storedAgentSessionRow(
          finalizePendingResult(
            pendingResult,
            firstInit.sessionId !== undefined &&
              firstInit.sessionId === parseContext.claude.sessionId,
            parseContext.claude.turn,
          ),
        ),
      );
      pendingResult = null;
    }
  }

  for (const [index, record] of records.entries()) {
    if (record.type !== 'agent_session') {
      storedRecords.push(record);
      continue;
    }

    if (parseContext?.claude !== undefined && latestClaudeInitIndicesBySessionId !== undefined) {
      parseContext.isFinalResult = !hasFutureClaudeInit(
        latestClaudeInitIndicesBySessionId,
        index,
        parseContext.claude.sessionId,
      );
    }

    for (const row of parseSessionRecord(agentSessionRecord(record), harness, parseContext)) {
      if (parseContext?.claude !== undefined && !isStreamFinal && isClaudeFinalResultRow(row)) {
        if (pendingResult !== null) {
          storedRecords.push(storedAgentSessionRow(pendingResult));
        }
        pendingResult = row;
        continue;
      }
      storedRecords.push(storedAgentSessionRow(row));
    }
  }

  if (isStreamFinal && parseContext?.claude !== undefined) {
    for (const row of flushPendingToolRows(parseContext.claude)) {
      storedRecords.push(storedAgentSessionRow(row));
    }
  }

  const body = Buffer.from(storedRecords.map((record) => `${JSON.stringify(record)}\n`).join(''));
  const recordCounts: Partial<Record<LogRecord['type'], number>> = {};
  for (const record of storedRecords) {
    recordCounts[record.type] = (recordCounts[record.type] ?? 0) + 1;
  }

  return {
    body,
    recordCounts,
    claudeParseContext: parseContext?.claude,
    claudePendingResult: parseContext?.claude === undefined ? undefined : pendingResult,
    claudePendingToolRows: parseContext?.claude?.pendingToolRows,
  };
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
  const {declaredTotalBytes} = parsed;
  const sessionHarness = parsed.hasAgentSessionRecord
    ? await getSessionHarness(workflows, params.stepId)
    : DEFAULT_HARNESS;
  const commitByteLen = params.body.length;
  const metrics = {
    recordCounts: {} as Partial<Record<LogRecordMetricKind, number>>,
    streamClosedReason: undefined as 'declared' | undefined,
    streamOpened: false,
  };

  const result = await db().transaction(async (tx) => {
    if (commitByteLen === 0) return readHeartbeat(tx, params);

    const {created, stream} = await getOrCreateAttemptStreamWithStatus(tx, {
      jobId: params.jobId,
      stepId: params.stepId,
      attempt: params.attempt,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      workflowRunAttemptId: params.workflowRunAttemptId,
    });
    metrics.streamOpened = created;

    // Closed stream (the runner's end already landed, or the job-terminated sweep ran):
    // accept-and-drop so a late chunk can never race compaction. committed_length is
    // frozen at close, so this reports the final offset and the runner stops cleanly.
    if (stream.state === 'closed') {
      return {committedLength: stream.committedLength, capped: await isJobCapped(tx, params.jobId)};
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

    const parseHarness =
      sessionHarness === 'claude' ||
      stream.claudePendingResult !== null ||
      stream.claudePendingToolRows.length > 0
        ? 'claude'
        : sessionHarness;
    const stored = buildStoredBody(
      parsed.records,
      parseHarness,
      parseHarness === 'claude'
        ? createClaudeParseContext(stream.claudePendingToolRows, {
            hasInit: stream.claudeHasInit,
            sessionId: stream.claudeSessionId,
            turn: stream.claudeTurn,
          })
        : undefined,
      parseHarness === 'claude' ? stream.claudePendingResult : undefined,
      declaredTotalBytes !== undefined,
    );

    const {
      recordCounts,
      stored: chunkStored,
      ...result
    } = await storeChunk(tx, {
      params,
      streamId: stream.id,
      body: stored.body,
      committedLength: cas.committedLength,
      declaredTotalBytes,
    });
    if (chunkStored) {
      addRecordCounts(metrics.recordCounts, stored.recordCounts);
      if (stored.claudeParseContext !== undefined) {
        await setClaudeParseContext(tx, {
          streamId: stream.id,
          hasInit: stored.claudeParseContext.hasInit,
          sessionId: stored.claudeParseContext.sessionId,
          turn: stored.claudeParseContext.turn,
          pendingResult: stored.claudePendingResult ?? null,
          pendingToolRows: stored.claudePendingToolRows ?? [],
        });
      }
    }
    addRecordCounts(metrics.recordCounts, recordCounts);

    // The runner's end record was committed in this append (offset-CAS guarantees
    // everything before it is already committed), so the stream is whole. Declared-close
    // it in-band so compaction starts at once instead of waiting for the timeout sweep.
    // Only when the chunk was actually stored: an end body dropped because the job was
    // already capped persists nothing, so the stream is not whole and stays open for the
    // timeout sweep to close it as truncated.
    if (declaredTotalBytes !== undefined && chunkStored) {
      const closed = await closeStream(tx, {streamId: stream.id, reason: 'declared'});
      if (closed) metrics.streamClosedReason = 'declared';
    }

    return result;
  });

  if (metrics.streamOpened) streamOpenedCount.add(1);
  for (const [kind, count] of Object.entries(metrics.recordCounts)) {
    if (count > 0) recordAppendedCount.add(count, {kind: kind as LogRecordMetricKind});
  }
  if (metrics.streamClosedReason) {
    streamClosedCount.add(1, {reason: metrics.streamClosedReason});
  }

  return result;
}

function addRecordCounts(
  target: Partial<Record<LogRecordMetricKind, number>>,
  source: Partial<Record<LogRecordMetricKind, number>>,
): void {
  for (const [kind, count] of Object.entries(source)) {
    target[kind as LogRecordMetricKind] = (target[kind as LogRecordMetricKind] ?? 0) + (count ?? 0);
  }
}
