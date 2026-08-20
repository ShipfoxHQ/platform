import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {Context} from '@temporalio/activity';
import {compactedObjectKey, deleteObject, putCompactedObject} from '#api/object-storage.js';
import {compactedGzipStream} from '#core/compaction.js';
import {chunkStats} from '#db/chunks.js';
import {db, type Transaction} from '#db/db.js';
import {getAttemptStreamById, setObjectKeyAndDeleteChunks} from '#db/streams.js';
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
    params: {streamId: string; objectKey: string},
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
 *                 └─ else: upload to a per-attempt key ─► gzip ─► multipart (abort-aware, heartbeat)
 *                          │
 *                 verify streamed count/maxSeq/bytes == table  (mismatch ─► delete upload, throw, retry)
 *                          │
 *                 tx: set object_key (state='closed' AND object_key IS NULL) + delete chunks
 *                          └─ 0 rows ─► delete this attempt's upload, then re-read the row:
 *                                         gone ─► retention raced · keyed ─► superseded by another attempt
 *
 * Each attempt uploads to its own `compactedObjectKey(stream, uuid)`, so a slow or zombie
 * attempt can never overwrite a published object. The single-winner publish (object_key set
 * + chunk delete, atomic) drops chunks only once a complete object is durable; the integrity
 * check (count, maxSeq, and byte total) guards a read bug from publishing a truncated object
 * before the only copy of the source is gone (S3 part checksums cover byte transfer).
 */
async function compactStream(
  params: {streamId: string},
  dependencies: CompactStreamDependencies,
): Promise<CompactStreamResult> {
  const stream = await getAttemptStreamById(params.streamId);
  if (!stream) return {outcome: 'gone'};
  if (stream.objectKey) return {outcome: 'already-compacted'};

  const ctx = Context.current();
  const uploadKey = compactedObjectKey(stream, crypto.randomUUID());
  const expected = await chunkStats(stream.id);
  const {body, stats} = dependencies.compactedGzipStream({
    streamId: stream.id,
    onPage: () => ctx.heartbeat(),
  });

  await putCompactedObject({
    key: uploadKey,
    body,
    signal: ctx.cancellationSignal,
    onProgress: () => ctx.heartbeat(),
    metadata: {
      stream_id: stream.id,
      chunk_count: String(expected.count),
      uncompressed_bytes: String(expected.uncompressedBytes),
      last_seq: String(expected.maxSeq),
    },
  });

  if (
    stats.chunkCount !== expected.count ||
    stats.lastSeq !== expected.maxSeq ||
    stats.uncompressedBytes !== expected.uncompressedBytes
  ) {
    await deleteObject(uploadKey).catch((error) => {
      logger().error(
        {err: error, streamId: stream.id, objectKey: uploadKey},
        'Failed to delete invalid compacted log object',
      );
      reportError(error, {
        boundary: 'logs.cleanup',
        operation: 'delete-invalid-compaction-object',
        extra: {streamId: stream.id, objectKey: uploadKey},
      });
    });
    throw new Error(
      `Compaction integrity check failed for stream ${stream.id}: streamed ${stats.chunkCount} chunks / ${stats.uncompressedBytes} bytes up to seq ${stats.lastSeq}, table holds ${expected.count} / ${expected.uncompressedBytes} bytes up to seq ${expected.maxSeq}`,
    );
  }

  const {updated} = await db().transaction((tx) =>
    dependencies.setObjectKeyAndDeleteChunks(tx, {
      streamId: stream.id,
      objectKey: uploadKey,
    }),
  );
  if (!updated) {
    await deleteObject(uploadKey);
    const current = await getAttemptStreamById(stream.id);
    return {outcome: current ? 'superseded' : 'retention-raced'};
  }

  return {
    outcome: 'compacted',
    objectKey: uploadKey,
    chunkCount: stats.chunkCount,
    uncompressedBytes: stats.uncompressedBytes,
  };
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
