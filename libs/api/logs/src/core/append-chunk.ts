import type {Buffer} from 'node:buffer';
import type {LogRecord} from '@shipfox/api-logs-dto';
import {config} from '#config.js';
import {accrueStoredBytes, claimCap, ensureJobAccounting, isJobCapped} from '#db/accounting.js';
import {insertChunk} from '#db/chunks.js';
import type {Transaction} from '#db/db.js';
import type {ChunkOrigin} from '#db/schema/chunks.js';
import {getAttemptStream, setDeclaredTotalBytes} from '#db/streams.js';
import {allowedBudget} from './budget.js';
import {controlTombstone} from './close-stream.js';

/**
 * The identity a chunk is appended under: the stream is scoped by `(jobId,
 * stepId, attempt)` and stamped with the workspace/project/run so a mismatched
 * writer is rejected. Shared by the lease-bound runner append and the
 * inter-module server-origin append.
 */
export interface AppendIdentity {
  jobId: string;
  workspaceId: string;
  projectId: string;
  workflowRunAttemptId: string;
  stepId: string;
  attempt: number;
}

export interface AppendLogsResult {
  committedLength: number;
  capped: boolean;
}

/**
 * Empty-body heartbeat: report the current committed length without materializing
 * a stream, so a runner cannot mint unbounded rows with empty appends.
 */
export async function readHeartbeat(
  tx: Transaction,
  params: AppendIdentity,
): Promise<AppendLogsResult> {
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

export interface StoreChunkParams {
  params: AppendIdentity;
  streamId: string;
  /** Runner-axis position of this chunk (the CAS offset it was appended at). */
  streamOffset: number;
  body: Buffer;
  committedLength: number;
  declaredTotalBytes: number | undefined;
  /** Writer of the chunk: `runner` (lease-bound append) or `server` (inter-module append). */
  origin: ChunkOrigin;
}

export interface StoreChunkResult extends AppendLogsResult {
  /**
   * Whether the chunk was persisted. False only when the job was already
   * capped and the body (including any `end` record) was dropped, so the stream is
   * not whole and must not be declared-closed.
   */
  stored: boolean;
  recordCounts: Partial<Record<LogRecord['type'], number>>;
}

/**
 * Accrues the stored bytes, persists the chunk, and trips the per-job cap when
 * this append crosses the budget. Runs only after the offset-CAS extended
 * `committed_length`, so the committed length already reflects the accepted bytes.
 */
export async function storeChunk(
  tx: Transaction,
  {
    params,
    streamId,
    streamOffset,
    body,
    committedLength,
    declaredTotalBytes,
    origin,
  }: StoreChunkParams,
): Promise<StoreChunkResult> {
  await ensureJobAccounting(tx, {jobId: params.jobId, workspaceId: params.workspaceId});
  const storedByteLen = body.length;
  const accrued = await accrueStoredBytes(tx, {jobId: params.jobId, delta: storedByteLen});

  // Already capped: accept-and-drop. committed_length has advanced so the writer
  // drains its spool cleanly instead of retry-looping; nothing is stored.
  if (!accrued) return {committedLength, capped: true, stored: false, recordCounts: {}};

  await insertChunk(tx, {
    streamId,
    streamOffset,
    byteLen: storedByteLen,
    data: body,
    origin,
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
