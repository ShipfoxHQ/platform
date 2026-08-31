import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {deleteObjectsByPrefix} from '#api/object-storage.js';
import {config} from '#config.js';
import type {AttemptStream} from '#core/entities/attempt-stream.js';
import {logObjectKey} from '#core/entities/log-object.js';
import {deleteJobAccounting} from '#db/accounting.js';
import {db} from '#db/db.js';
import {
  accountingHasNoStreams,
  deleteExpiredStream,
  getAttemptStreamById,
  listExpiredClosedStreams,
} from '#db/streams.js';

export interface RetentionSweepResult {
  /** Streams whose objects and row were deleted. */
  deleted: number;
  /** Streams skipped because compaction changed `object_key` after we read it (retried next run). */
  raced: number;
  /** Streams whose object cleanup or guarded row delete threw; logged, skipped, and retried next run. */
  failed: number;
  accountingPruned: number;
  iterations: number;
  /** True when the sweep stopped on its wall-clock budget with backlog likely remaining. */
  timedOut: boolean;
}

export interface RunRetentionSweepParams {
  retentionDays: number;
  batchLimit: number;
  timeBudgetMs: number;
  maxIterations: number;
  /** Wall clock; injectable so tests can drive the time budget deterministically. */
  now?: () => number;
  /** Liveness signal (e.g. the activity heartbeat); invoked once per processed stream. */
  onProgress?: () => void;
}

function deleteExpiredStreamObjects(stream: AttemptStream): Promise<void> {
  return deleteObjectsByPrefix(`${logObjectKey(config.LOG_STORAGE_S3_PREFIX, stream)}/`);
}

function deleteExpiredStreamRow(params: {
  stream: AttemptStream;
  retentionDays: number;
}): Promise<{deleted: boolean; prunedAccounting: boolean}> {
  return db().transaction(async (tx) => {
    const {deleted, jobId} = await deleteExpiredStream(tx, {
      streamId: params.stream.id,
      observedObjectKey: params.stream.objectKey,
    });
    if (deleted && jobId && (await accountingHasNoStreams(tx, jobId))) {
      const pruned = await deleteJobAccounting(tx, {
        jobId,
        retentionDays: params.retentionDays,
      });
      return {deleted, prunedAccounting: pruned.deleted};
    }
    return {deleted, prunedAccounting: false};
  });
}

/**
 * Deletes expired closed streams and prunes accounting for emptied jobs.
 *
 * The loop self-bounds because a Temporal `startToCloseTimeout` marks the activity failed but
 * does not stop already-running JS. Objects are deleted before rows so a cleanup failure leaves
 * the row discoverable for the next sweep; the row delete stays guarded on the observed
 * `object_key`, so a racing compaction publish is re-read before the row is removed.
 */
export async function runRetentionSweep(
  params: RunRetentionSweepParams,
): Promise<RetentionSweepResult> {
  const now = params.now ?? Date.now;
  const deadline = now() + params.timeBudgetMs;
  const result: RetentionSweepResult = {
    deleted: 0,
    raced: 0,
    failed: 0,
    accountingPruned: 0,
    iterations: 0,
    timedOut: false,
  };

  // Failed or raced rows retry next run; skipping them here keeps the rest of the backlog moving.
  const skip = new Set<string>();
  while (result.iterations < params.maxIterations) {
    if (now() >= deadline) {
      result.timedOut = true;
      break;
    }

    const batch = await listExpiredClosedStreams({
      retentionDays: params.retentionDays,
      limit: params.batchLimit,
      excludeIds: skip.size > 0 ? [...skip] : undefined,
    });
    if (batch.length === 0) break;

    if (await processRetentionBatch(batch, params, result, skip, now, deadline)) break;

    result.iterations += 1;
    if (batch.length < params.batchLimit) break;
  }

  return result;
}

async function processRetentionBatch(
  batch: readonly AttemptStream[],
  params: RunRetentionSweepParams,
  result: RetentionSweepResult,
  skip: Set<string>,
  now: () => number,
  deadline: number,
): Promise<boolean> {
  for (const stream of batch) {
    params.onProgress?.();
    if (now() >= deadline) {
      result.timedOut = true;
      return true;
    }
    await processExpiredStream(stream, params.retentionDays, result, skip);
  }
  return false;
}

type RetentionAttempt<T> = {readonly ok: true; readonly value: T} | {readonly ok: false};

async function attemptRetentionOperation<T>(
  streamId: string,
  result: RetentionSweepResult,
  skip: Set<string>,
  message: string,
  operation: () => Promise<T>,
): Promise<RetentionAttempt<T>> {
  try {
    return {ok: true, value: await operation()};
  } catch (error) {
    result.failed += 1;
    skip.add(streamId);
    logger().error({err: error, streamId}, message);
    reportError(error, {boundary: 'logs.maintenance', extra: {streamId}});
    return {ok: false};
  }
}

async function processExpiredStream(
  stream: AttemptStream,
  retentionDays: number,
  result: RetentionSweepResult,
  skip: Set<string>,
): Promise<void> {
  const objectDelete = await attemptRetentionOperation(
    stream.id,
    result,
    skip,
    'Failed to delete expired log stream objects',
    () => deleteExpiredStreamObjects(stream),
  );
  if (!objectDelete.ok) return;

  const rowDelete = await attemptRetentionOperation(
    stream.id,
    result,
    skip,
    'Failed to delete expired log stream row',
    () => deleteExpiredStreamRow({stream, retentionDays}),
  );
  if (!rowDelete.ok) return;
  if (rowDelete.value.deleted) {
    recordRetentionDeletion(rowDelete.value, result);
    return;
  }
  await retryRacedExpiredStream(stream.id, retentionDays, result, skip);
}

async function retryRacedExpiredStream(
  streamId: string,
  retentionDays: number,
  result: RetentionSweepResult,
  skip: Set<string>,
): Promise<void> {
  const reload = await attemptRetentionOperation(
    streamId,
    result,
    skip,
    'Failed to reload raced expired log stream',
    () => getAttemptStreamById(streamId),
  );
  if (!reload.ok) return;
  if (reload.value === null) {
    recordRetentionRace(streamId, result, skip);
    return;
  }
  const current = reload.value;
  const retry = await attemptRetentionOperation(
    streamId,
    result,
    skip,
    'Failed to delete raced expired log stream',
    async () => {
      await deleteExpiredStreamObjects(current);
      return deleteExpiredStreamRow({stream: current, retentionDays});
    },
  );
  if (!retry.ok) return;
  if (!retry.value.deleted) {
    recordRetentionRace(streamId, result, skip);
    return;
  }
  recordRetentionDeletion(retry.value, result);
}

function recordRetentionRace(
  streamId: string,
  result: RetentionSweepResult,
  skip: Set<string>,
): void {
  result.raced += 1;
  skip.add(streamId);
}

function recordRetentionDeletion(
  outcome: {deleted: boolean; prunedAccounting: boolean},
  result: RetentionSweepResult,
): void {
  result.deleted += 1;
  if (outcome.prunedAccounting) result.accountingPruned += 1;
}
