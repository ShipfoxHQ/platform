import {Buffer} from 'node:buffer';
import {type LogRecord, type ServerLogRecord, serverLogRecordSchema} from '@shipfox/api-logs-dto';
import {config} from '#config.js';
import {isJobCapped} from '#db/accounting.js';
import {getStreamWriterOrigin} from '#db/chunks.js';
import {db} from '#db/db.js';
import {casExtendCommittedLength, getOrCreateAttemptStreamWithStatus} from '#db/streams.js';
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
import {
  LogAppendBodyTooLargeError,
  LogWriterConflictError,
  MalformedLogChunkError,
  OffsetGapError,
} from './errors.js';

export interface AppendServerRecordsParams extends AppendIdentity {
  /**
   * Already-normalized server-writable stored records (the read union without
   * server-only tombstones). Server-origin records skip the raw-to-stored
   * normalization the runner path applies (session parsing etc.): each record
   * is validated against the shared contract and stored verbatim as one whole
   * newline-terminated NDJSON line.
   */
  records: ServerLogRecord[];
}

interface ServerBody {
  body: Buffer;
  declaredTotalBytes: number | undefined;
  recordCounts: Partial<Record<LogRecord['type'], number>>;
}

/**
 * Serializes validated stored records into the same whole-line NDJSON shape the
 * runner path stores, so the offset-CAS axis and the per-record byte budget are
 * exactly the runner's. The declared total is pulled from an `end` record, and
 * the stream declared-closes in-band when such a body is stored, exactly like
 * the runner path; the attempt-terminated subscriber still closes streams the
 * server writer never ends.
 */
function buildServerBody(records: readonly ServerLogRecord[]): ServerBody {
  if (records.length === 0)
    return {body: Buffer.alloc(0), declaredTotalBytes: undefined, recordCounts: {}};

  const endIndexes = records.flatMap((record, index) => (record.type === 'end' ? [index] : []));
  if (endIndexes.length > 1 || (endIndexes[0] ?? records.length - 1) !== records.length - 1) {
    throw new MalformedLogChunkError(
      'server append may contain only one end record, and it must be final',
    );
  }

  const body = Buffer.from(records.map((record) => `${JSON.stringify(record)}\n`).join(''));
  let declaredTotalBytes: number | undefined;
  const recordCounts: Partial<Record<LogRecord['type'], number>> = {};
  for (const record of records) {
    recordCounts[record.type] = (recordCounts[record.type] ?? 0) + 1;
    if (record.type === 'end') declaredTotalBytes = record.total_bytes;
  }
  return {body, declaredTotalBytes, recordCounts};
}

/**
 * Inter-module server-origin append: writes already-normalized records for a
 * step attempt through the same offset CAS, budget, and cap as the lease-bound
 * runner append (`appendLogs`), storing chunks with `origin: 'server'`.
 *
 * The caller owns no spool cursor, so the CAS offset is the stream's current
 * committed length: the batch always lands at the tail. Server-origin and
 * runner-origin writers are mutually exclusive because the runner's local spool
 * offset cannot represent bytes inserted by another origin. Concurrent
 * server-origin calls are serialized by the stream row lock.
 */
export async function appendServerRecords(
  params: AppendServerRecordsParams,
): Promise<AppendLogsResult> {
  const parsed = serverLogRecordSchema.array().safeParse(params.records);
  if (!parsed.success) {
    throw new MalformedLogChunkError('append records contain an invalid log record');
  }
  const {body, declaredTotalBytes, recordCounts} = buildServerBody(parsed.data);
  if (body.length > config.LOG_APPEND_BODY_LIMIT_BYTES) {
    throw new LogAppendBodyTooLargeError(config.LOG_APPEND_BODY_LIMIT_BYTES);
  }
  const metrics = {
    recordCounts: {} as Partial<Record<LogRecordMetricKind, number>>,
    streamClosedReason: undefined as 'declared' | undefined,
    streamOpened: false,
    // Serialized server-record bytes accepted by the in-order CAS; durable bytes written
    // to chunk rows. Both are accumulated inside the transaction and recorded only after it
    // commits, so a rolled-back append never counts. Same axes as the runner path.
    ingestedBytes: 0,
    storedBytes: 0,
  };

  const result = await db().transaction(async (tx) => {
    if (body.length === 0) return readHeartbeat(tx, params);

    // Tail append: the stream upsert locks the row for the transaction, so this fresh tail
    // cannot race another append. A retry outcome would violate that invariant and is treated
    // as an internal consistency failure instead of looping over dead code.
    const {created, stream} = await getOrCreateAttemptStreamWithStatus(tx, {
      jobId: params.jobId,
      stepId: params.stepId,
      attempt: params.attempt,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      workflowRunAttemptId: params.workflowRunAttemptId,
    });
    metrics.streamOpened = created;

    // Closed stream (an end already landed, or the job-terminated sweep ran):
    // accept-and-drop so a late batch can never race compaction. committed_length is
    // frozen at close, so this reports the final offset and the caller stops cleanly.
    if (stream.state === 'closed') {
      return {
        committedLength: stream.committedLength,
        capped: await isJobCapped(tx, params.jobId),
      };
    }

    if ((await getStreamWriterOrigin(tx, stream.id)) === 'runner') {
      throw new LogWriterConflictError('runner');
    }

    const cas = await casExtendCommittedLength(tx, {
      streamId: stream.id,
      offset: stream.committedLength,
      byteLen: body.length,
    });
    if (cas.outcome === 'gap') throw new OffsetGapError(cas.committedLength);
    if (cas.outcome === 'retry') {
      throw new Error('Server append CAS did not extend the locked stream tail');
    }
    // In-order CAS extension: the batch is accepted at the tail and counted once.
    metrics.ingestedBytes += body.length;

    const {
      recordCounts: chunkRecordCounts,
      stored: chunkStored,
      ...chunkResult
    } = await storeChunk(tx, {
      params,
      streamId: stream.id,
      streamOffset: stream.committedLength,
      body,
      committedLength: cas.committedLength,
      declaredTotalBytes,
      origin: 'server',
    });
    if (chunkStored) {
      // Normalized durable bytes; a cap-dropped straggler never reaches this branch.
      metrics.storedBytes += body.length;
      addRecordCounts(metrics.recordCounts, chunkRecordCounts);
      addRecordCounts(metrics.recordCounts, recordCounts);
    }

    // An `end` record committed in this batch (the offset-CAS guarantees everything
    // before it is already committed), so the stream is whole. Declared-close it
    // in-band exactly like the runner path, and only when the chunk was actually
    // stored: an end body dropped because the job was already capped persists
    // nothing, so the stream is not whole and stays open for the timeout sweep.
    if (declaredTotalBytes !== undefined && chunkStored) {
      const closed = await closeStream(tx, {streamId: stream.id, reason: 'declared'});
      if (closed) metrics.streamClosedReason = 'declared';
    }

    return chunkResult;
  });

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

function addRecordCounts(
  target: Partial<Record<LogRecordMetricKind, number>>,
  source: Partial<Record<LogRecordMetricKind, number>>,
): void {
  for (const [kind, count] of Object.entries(source)) {
    target[kind as LogRecordMetricKind] = (target[kind as LogRecordMetricKind] ?? 0) + (count ?? 0);
  }
}
