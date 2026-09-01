import {Readable} from 'node:stream';
import {createGzip} from 'node:zlib';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {Context} from '@temporalio/activity';
import {
  compactedObjectKey,
  compactedTailObjectKey,
  deleteObject,
  headObject,
  putCompactedObject,
} from '#api/object-storage.js';
import {type CompactionTailArtifact, compactedGzipStream} from '#core/compaction.js';
import type {AttemptStream} from '#core/entities/attempt-stream.js';
import {MAX_STEP_LOG_TAIL_BYTES, MAX_STEP_LOG_TAIL_LINES} from '#core/log-tail.js';
import {chunkStats} from '#db/chunks.js';
import {db, type Transaction} from '#db/db.js';
import {
  claimCompactionUploadKey,
  clearCompactionUploadKeys,
  getAttemptStreamById,
  setObjectKeyAndDeleteChunks,
} from '#db/streams.js';
import {
  type CompactionMetricOutcome,
  compactedBytesCount,
  compactionCount,
} from '#metrics/instance.js';

export type CompactStreamResult =
  | {outcome: 'gone'}
  | {outcome: 'already-compacted'}
  | {outcome: 'superseded'}
  | {outcome: 'retention-raced'}
  | {outcome: 'compacted'; objectKey: string; chunkCount: number; uncompressedBytes: number};

interface CompactStreamDependencies {
  compactedGzipStream: typeof compactedGzipStream;
  setObjectKeyAndDeleteChunks: (
    tx: Transaction,
    params: {streamId: string; objectKey: string; lineCount?: number},
  ) => Promise<{updated: boolean}>;
}

const defaultDependencies: CompactStreamDependencies = {
  compactedGzipStream,
  setObjectKeyAndDeleteChunks,
};

/**
 * Compacts one closed stream into a single gzip NDJSON object, then deletes its chunk rows.
 *
 *   load stream ──┬─ gone ─────────────► no-op (retention raced)
 *                 ├─ object_key set ───► no-op (idempotent re-run)
 *                 └─ else: reserve/upload a per-attempt key ─► gzip ─► multipart (abort-aware, heartbeat)
 *                          │
 *                 verify streamed count/maxSeq/bytes == table and both object heads
 *                          (mismatch ─► delete both uploads, throw, retry)
 *                          │
 *                 tx: set object_key + line_count (state='closed' AND object_key IS NULL) + delete chunks
 *                          └─ 0 rows ─► delete both uploads, then re-read the row:
 *                                         gone ─► retention raced · keyed ─► superseded by another attempt
 *
 * Each attempt uploads to its own `compactedObjectKey(stream, uuid)`, so a slow or zombie
 * attempt can never overwrite a published object. The reserved keys are recorded on the stream
 * before upload, which lets a later retry find and clean an attempt whose post-error DB read
 * failed. The single-winner publish (object_key and line_count set + chunk delete, atomic) drops
 * chunks only once both complete objects are durable; the integrity check (count, maxSeq, and
 * byte total) guards a read bug from publishing a truncated object before the only copy of the
 * source is gone (S3 part checksums cover byte transfer). Reservations are cleared after their
 * unreferenced objects are deleted.
 */
async function compactStream(
  params: {streamId: string},
  dependencies: CompactStreamDependencies,
): Promise<CompactStreamResult> {
  const preparation = await prepareCompaction(params.streamId);
  if (preparation.outcome !== 'claimed') return preparation;

  const {stream, uploadKey} = preparation;
  const ctx = Context.current();
  const tailKey = compactedTailObjectKey(uploadKey);
  let cleanupComplete = false;
  let published = false;

  const cleanupUploads = async (): Promise<void> => {
    if (cleanupComplete) return;
    await deleteCompactionUploads(stream.id, [uploadKey, tailKey]);
    cleanupComplete = true;
  };

  const cleanupUnlessPublished = async (): Promise<void> => {
    // A client-side error can arrive after the publication transaction committed. Never delete
    // the only durable copies until a fresh primary read proves this attempt did not publish.
    let current: AttemptStream | null;
    try {
      current = await getAttemptStreamById(stream.id);
    } catch {
      // Preserve the uploads when the read needed to disambiguate commit state fails. The
      // reservation was written before upload, so a retry can find these keys and clean them
      // after it determines whether publication happened.
      return;
    }
    if (current?.objectKey === uploadKey) {
      cleanupComplete = true;
      await cleanupPublishedCompactionUploads(stream.id, uploadKey);
      return;
    }
    await cleanupUploads();
  };

  const expected = await chunkStats(stream.id);
  try {
    const {stats, artifact} = await uploadCompactionObjects({
      stream,
      expected,
      dependencies,
      uploadKey,
      tailKey,
      heartbeat: () => ctx.heartbeat(),
      cancellationSignal: ctx.cancellationSignal,
    });

    const {updated} = await db().transaction((tx) =>
      dependencies.setObjectKeyAndDeleteChunks(tx, {
        streamId: stream.id,
        objectKey: uploadKey,
        lineCount: artifact.lineCount,
      }),
    );
    if (!updated) {
      await cleanupUploads();
      const current = await getAttemptStreamById(stream.id);
      if (current?.objectKey) await cleanupPublishedCompactionUploadsIfNeeded(current);
      return {outcome: current ? 'superseded' : 'retention-raced'};
    }

    published = true;
    await cleanupPublishedCompactionUploads(stream.id, uploadKey);
    return {
      outcome: 'compacted',
      objectKey: uploadKey,
      chunkCount: stats.chunkCount,
      uncompressedBytes: stats.uncompressedBytes,
    };
  } catch (error) {
    if (!published) {
      try {
        await cleanupUnlessPublished();
      } catch {
        // The cleanup helper has already logged and reported each failed delete. Preserve the
        // original compaction error so Temporal retries the work and the row stays hot.
      }
    }
    throw error;
  }
}

type CompactionPreparation =
  | {outcome: 'gone'}
  | {outcome: 'already-compacted'}
  | {outcome: 'claimed'; stream: AttemptStream; uploadKey: string};

async function prepareCompaction(streamId: string): Promise<CompactionPreparation> {
  const stream = await getAttemptStreamById(streamId);
  if (!stream) return {outcome: 'gone'};
  if (stream.objectKey) {
    await cleanupPublishedCompactionUploadsIfNeeded(stream);
    return {outcome: 'already-compacted'};
  }

  const claim = await db().transaction((tx) =>
    claimCompactionUploadKey(tx, {
      streamId: stream.id,
      objectKey: compactedObjectKey(stream, crypto.randomUUID()),
    }),
  );
  if (claim.outcome === 'claimed') {
    return {outcome: 'claimed', stream, uploadKey: claim.objectKey};
  }
  if (claim.outcome === 'already-compacted') {
    const current = await getAttemptStreamById(stream.id);
    if (current?.objectKey) await cleanupPublishedCompactionUploadsIfNeeded(current);
  }
  return {outcome: claim.outcome};
}

async function cleanupPublishedCompactionUploadsIfNeeded(stream: AttemptStream): Promise<void> {
  if (!stream.objectKey || stream.compactionUploadKeys.length === 0) return;
  await cleanupPublishedCompactionUploads(stream.id, stream.objectKey);
}

/** Best-effort cleanup for persisted loser keys after a winner has published. */
async function cleanupPublishedCompactionUploads(
  streamId: string,
  publishedObjectKey: string,
): Promise<void> {
  let stream: AttemptStream | null;
  try {
    stream = await getAttemptStreamById(streamId);
  } catch {
    return;
  }
  if (!stream || stream.objectKey !== publishedObjectKey) return;

  const orphanKeys = stream.compactionUploadKeys.filter((key) => key !== publishedObjectKey);
  try {
    await deleteCompactionUploads(
      streamId,
      orphanKeys.flatMap((key) => [key, compactedTailObjectKey(key)]),
    );
    await db().transaction((tx) =>
      clearCompactionUploadKeys(tx, {streamId, objectKey: publishedObjectKey}),
    );
  } catch {
    // Keep the reservations when cleanup or its DB acknowledgement fails. An idempotent
    // compaction pass will retry this best-effort cleanup before returning already-compacted.
  }
}

async function uploadCompactionObjects(params: {
  stream: AttemptStream;
  expected: Awaited<ReturnType<typeof chunkStats>>;
  dependencies: CompactStreamDependencies;
  uploadKey: string;
  tailKey: string;
  heartbeat: () => void;
  cancellationSignal: AbortSignal;
}): Promise<{
  stats: Awaited<ReturnType<typeof compactedGzipStream>>['stats'];
  artifact: CompactionTailArtifact;
}> {
  const {body, stats, tailArtifact} = params.dependencies.compactedGzipStream({
    streamId: params.stream.id,
    onPage: params.heartbeat,
  });
  const fullMetadata = {
    stream_id: params.stream.id,
    chunk_count: String(params.expected.count),
    uncompressed_bytes: String(params.expected.uncompressedBytes),
    last_seq: String(params.expected.maxSeq),
  };
  await putCompactedObject({
    key: params.uploadKey,
    body,
    signal: params.cancellationSignal,
    onProgress: params.heartbeat,
    metadata: fullMetadata,
  });

  assertCompactionStatsMatch(params.stream.id, stats, params.expected);
  const artifact = await tailArtifact;
  assertTailArtifactWithinBounds(params.stream.id, stats, artifact);

  const tailMetadata = {
    stream_id: params.stream.id,
    line_count: String(artifact.lineCount),
    tail_line_count: String(artifact.tailLineCount),
    uncompressed_bytes: String(artifact.body.length),
  };
  const tailGzip = createGzip();
  Readable.from([artifact.body]).pipe(tailGzip);
  await putCompactedObject({
    key: params.tailKey,
    body: tailGzip,
    signal: params.cancellationSignal,
    onProgress: params.heartbeat,
    metadata: tailMetadata,
  });

  await verifyCompactedObject(params.uploadKey, fullMetadata);
  await verifyCompactedObject(params.tailKey, tailMetadata);
  return {stats, artifact};
}

function assertCompactionStatsMatch(
  streamId: string,
  stats: Awaited<ReturnType<typeof compactedGzipStream>>['stats'],
  expected: Awaited<ReturnType<typeof chunkStats>>,
): void {
  const matches =
    stats.chunkCount === expected.count &&
    stats.lastSeq === expected.maxSeq &&
    stats.uncompressedBytes === expected.uncompressedBytes;
  if (matches) return;
  throw new Error(
    `Compaction integrity check failed for stream ${streamId}: streamed ${stats.chunkCount} chunks / ${stats.uncompressedBytes} bytes up to seq ${stats.lastSeq}, table holds ${expected.count} / ${expected.uncompressedBytes} bytes up to seq ${expected.maxSeq}`,
  );
}

function assertTailArtifactWithinBounds(
  streamId: string,
  stats: Awaited<ReturnType<typeof compactedGzipStream>>['stats'],
  artifact: CompactionTailArtifact,
): void {
  const withinBounds =
    artifact.body.length <= MAX_STEP_LOG_TAIL_BYTES &&
    artifact.tailLineCount <= MAX_STEP_LOG_TAIL_LINES &&
    artifact.tailLineCount >= 0 &&
    artifact.lineCount >= artifact.tailLineCount &&
    (stats.lineCount === undefined || stats.lineCount === artifact.lineCount);
  if (!withinBounds) {
    throw new Error(`Compaction tail artifact exceeded its bounds for stream ${streamId}`);
  }
}

async function deleteCompactionUploads(streamId: string, keys: readonly string[]): Promise<void> {
  const failures: unknown[] = [];
  for (const key of keys) {
    try {
      await deleteObject(key);
    } catch (error) {
      failures.push(error);
      logger().error(
        {err: error, streamId, objectKey: key},
        'Failed to delete temporary compacted log object',
      );
      reportError(error, {
        boundary: 'logs.cleanup',
        operation: 'delete-compaction-object',
        extra: {streamId, objectKey: key},
      });
    }
  }
  if (failures.length > 0) throw failures[0];
}

async function verifyCompactedObject(
  key: string,
  expectedMetadata: Record<string, string>,
): Promise<void> {
  const head = await headObject(key);
  if (!head) throw new Error(`Compacted log object ${key} disappeared before publication`);
  if (head.contentType !== 'application/x-ndjson' || head.contentEncoding !== 'gzip') {
    throw new Error(`Compacted log object ${key} has unexpected content metadata`);
  }
  if (head.contentLength === undefined || head.contentLength <= 0) {
    throw new Error(`Compacted log object ${key} has no stored bytes`);
  }
  for (const [name, value] of Object.entries(expectedMetadata)) {
    if (head.metadata[name] !== value) {
      throw new Error(`Compacted log object ${key} has unexpected ${name} metadata`);
    }
  }
}

export function createCompactStreamActivity(
  dependencies: CompactStreamDependencies = defaultDependencies,
): (params: {streamId: string}) => Promise<CompactStreamResult> {
  return async (params) => {
    let outcome: CompactionMetricOutcome = 'failed';
    try {
      const result = await compactStream(params, dependencies);
      outcome = result.outcome;
      // Count uncompressed log bytes only on the single-winner publish: idempotent re-runs
      // (`already-compacted`) and failed attempts never reach this branch, so the counter
      // tracks exactly the bytes durably moved to object storage.
      if (result.outcome === 'compacted') {
        compactedBytesCount.add(result.uncompressedBytes);
      }
      return result;
    } finally {
      compactionCount.add(1, {outcome});
    }
  };
}

export const compactStreamActivity = createCompactStreamActivity();
