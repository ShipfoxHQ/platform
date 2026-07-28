import {Buffer} from 'node:buffer';
import {LOG_STREAM_CLOSED, type LogRecord, type LogsEventMap} from '@shipfox/api-logs-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import type {AttemptStream, StreamCloseReason} from '#core/entities/attempt-stream.js';
import {insertChunk} from '#db/chunks.js';
import type {Transaction} from '#db/db.js';
import {logsOutbox} from '#db/schema/outbox.js';
import {markStreamClosed} from '#db/streams.js';

export type TombstoneKind = 'capped' | 'runner_lost';

/**
 * Frames a server tombstone as one newline-terminated record. Typed against the
 * shared contract so an envelope change breaks this at compile time. Stored as a
 * `control`-origin chunk; like every server record it does NOT advance
 * `committed_length`, so the CAS axis stays equal to runner spool bytes.
 */
export function controlTombstone(kind: TombstoneKind): Buffer {
  const record: LogRecord = {v: 1, ts: Date.now(), type: kind};
  return Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
}

export interface CloseStreamParams {
  streamId: string;
  reason: StreamCloseReason;
}

/**
 * The row lock plus guarded UPDATE (`WHERE state='open'`) in `markStreamClosed` provide
 * the lock and idempotency gate: a stream already closed by the other path (append-time
 * declared close vs the job-terminated timeout sweep) returns null, so no duplicate
 * `LOG_STREAM_CLOSED` is written and no second tombstone lands. A pending Claude result
 * is materialized before the close event, then a timeout close sets `truncated` and injects
 * a `runner_lost` tombstone in-band (a `capped` tombstone, if any, was injected earlier at
 * the append that tripped the cap).
 *
 * The event drives compaction; it is written in the same transaction as the flip.
 */
export async function closeStream(
  tx: Transaction,
  params: CloseStreamParams,
): Promise<AttemptStream | null> {
  const closedResult = await markStreamClosed(tx, {
    streamId: params.streamId,
    reason: params.reason,
    markTruncated: params.reason === 'timeout',
  });
  if (!closedResult) return null;

  const {stream: closed, pendingClaudeResult, pendingClaudeToolRows} = closedResult;
  if (pendingClaudeToolRows.length > 0) {
    const data = Buffer.from(
      `${pendingClaudeToolRows
        .map((row) =>
          JSON.stringify({v: 1, ts: row.timestamp, type: 'agent_session', row} satisfies LogRecord),
        )
        .join('\n')}\n`,
    );
    await insertChunk(tx, {
      streamId: closed.id,
      streamOffset: closed.committedLength,
      byteLen: data.length,
      data,
      origin: 'control',
    });
  }
  if (pendingClaudeResult !== null) {
    const record: LogRecord = {
      v: 1,
      ts: pendingClaudeResult.timestamp,
      type: 'agent_session',
      row: pendingClaudeResult,
    };
    const data = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
    await insertChunk(tx, {
      streamId: closed.id,
      streamOffset: closed.committedLength,
      byteLen: data.length,
      data,
      origin: 'control',
    });
  }

  if (params.reason === 'timeout') {
    const tombstone = controlTombstone('runner_lost');
    await insertChunk(tx, {
      streamId: closed.id,
      streamOffset: closed.committedLength,
      byteLen: tombstone.length,
      data: tombstone,
      origin: 'control',
    });
  }

  await writeOutboxEvent<LogsEventMap>(tx, logsOutbox, {
    type: LOG_STREAM_CLOSED,
    payload: {
      workspaceId: closed.workspaceId,
      jobId: closed.jobId,
      stepId: closed.stepId,
      attempt: closed.attempt,
      streamId: closed.id,
    },
  });

  return closed;
}
