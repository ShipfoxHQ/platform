import {Buffer} from 'node:buffer';
import {and, asc, desc, eq, gt, lt, lte, or, sql} from 'drizzle-orm';
import {db, type Transaction} from './db.js';
import {type ChunkOrigin, logChunks} from './schema/chunks.js';

export interface InsertChunkParams {
  streamId: string;
  streamOffset: number;
  byteLen: number;
  data: Buffer;
  origin: ChunkOrigin;
}

export async function insertChunk(tx: Transaction, params: InsertChunkParams): Promise<void> {
  await tx.insert(logChunks).values({
    streamId: params.streamId,
    streamOffset: params.streamOffset,
    byteLen: params.byteLen,
    data: params.data,
    origin: params.origin,
  });
}

export type AppendWriterOrigin = Exclude<ChunkOrigin, 'control'>;

/**
 * Returns the durable writer origin for a stream, if one has written a chunk. Control
 * tombstones do not claim the stream: they are emitted by the lifecycle owner after the
 * append writer has already been selected.
 */
export async function getStreamWriterOrigin(
  tx: Transaction,
  streamId: string,
): Promise<AppendWriterOrigin | null> {
  const [row] = await tx
    .select({origin: logChunks.origin})
    .from(logChunks)
    .where(
      and(
        eq(logChunks.streamId, streamId),
        or(eq(logChunks.origin, 'runner'), eq(logChunks.origin, 'server')),
      ),
    )
    .orderBy(asc(logChunks.seq))
    .limit(1);

  return row?.origin === 'runner' || row?.origin === 'server' ? row.origin : null;
}

export interface ChunkPageRow {
  seq: number;
  data: Buffer;
}

/**
 * One keyset page of a stream's chunk bytes in `seq` order. Compaction walks pages
 * with `afterSeq = lastSeqOfPreviousPage`, so memory stays flat regardless of stream
 * size, and reads run outside any transaction (no tx is pinned for the long upload).
 * Safe against late writers because a closed stream never accepts another chunk.
 */
export async function readChunksKeyset(params: {
  streamId: string;
  afterSeq: number;
  limit: number;
}): Promise<ChunkPageRow[]> {
  const rows = await db()
    .select({seq: logChunks.seq, data: logChunks.data})
    .from(logChunks)
    .where(and(eq(logChunks.streamId, params.streamId), gt(logChunks.seq, params.afterSeq)))
    .orderBy(asc(logChunks.seq))
    .limit(params.limit);
  return rows;
}

/**
 * One reverse keyset page for a hot tail read. The page is ordered newest first, and the
 * caller passes the last (oldest) sequence from the previous page as `beforeSeq`.
 */
export async function readChunksReverse(params: {
  streamId: string;
  beforeSeq?: number;
  limit: number;
}): Promise<ChunkPageRow[]> {
  const rows = await db()
    .select({seq: logChunks.seq, data: logChunks.data})
    .from(logChunks)
    .where(
      and(
        eq(logChunks.streamId, params.streamId),
        params.beforeSeq === undefined ? undefined : lt(logChunks.seq, params.beforeSeq),
      ),
    )
    .orderBy(desc(logChunks.seq))
    .limit(params.limit);
  return rows;
}

export interface ChunkPage {
  /** Concatenated chunk bytes for the page, in `seq` order: ready-to-serve NDJSON. */
  data: Buffer;
  /** The last `seq` included; the next read passes this as `afterSeq`. */
  nextSeq: number;
  /** Whether at least one more chunk exists past `nextSeq`. */
  hasMore: boolean;
}

// Caps the per-read metadata scan so a stream with pathologically many tiny chunks
// can't make one read walk the whole stream; the client re-polls (hasMore) past it.
const CHUNK_PAGE_SCAN_CAP = 4096;

/**
 * A byte-bounded page of a stream's chunk bytes in `seq` order, for the inline read path.
 * Walking by `seq` (not the runner byte offset) is what makes server-injected control tombstones
 * interleave with normalized runner records exactly as compaction concatenates them, so the inline
 * NDJSON is byte-identical to the compacted object.
 *
 * Returns at most ~`maxBytes`, but always at least one whole chunk so the cursor advances
 * even when a single chunk exceeds `maxBytes`. The cheap `(seq, byte_len)` scan picks the
 * prefix first, so the heavy `data` column is only materialized for the chunks actually
 * returned.
 */
export async function readChunkPageBySeq(params: {
  streamId: string;
  afterSeq: number;
  maxBytes: number;
}): Promise<ChunkPage> {
  const meta = await db()
    .select({seq: logChunks.seq, byteLen: logChunks.byteLen})
    .from(logChunks)
    .where(and(eq(logChunks.streamId, params.streamId), gt(logChunks.seq, params.afterSeq)))
    .orderBy(asc(logChunks.seq))
    .limit(CHUNK_PAGE_SCAN_CAP + 1);

  if (meta.length === 0) {
    return {data: Buffer.alloc(0), nextSeq: params.afterSeq, hasMore: false};
  }

  let accumulatedBytes = 0;
  let includedCount = 0;
  let nextSeq = params.afterSeq;
  for (const row of meta) {
    if (includedCount > 0 && accumulatedBytes + row.byteLen > params.maxBytes) break;
    accumulatedBytes += row.byteLen;
    nextSeq = row.seq;
    includedCount += 1;
    if (includedCount >= CHUNK_PAGE_SCAN_CAP) break;
  }

  const hasMore = includedCount < meta.length;

  const rows = await db()
    .select({data: logChunks.data})
    .from(logChunks)
    .where(
      and(
        eq(logChunks.streamId, params.streamId),
        gt(logChunks.seq, params.afterSeq),
        lte(logChunks.seq, nextSeq),
      ),
    )
    .orderBy(asc(logChunks.seq));

  return {data: Buffer.concat(rows.map((row) => row.data)), nextSeq, hasMore};
}

/**
 * Total bytes held in hot chunk rows across all streams, runner and server-injected
 * control chunks alike. Chunks are only deleted by compaction, so this is exactly the
 * un-compacted hot volume the service gauge reports (open streams plus closed streams
 * still awaiting compaction).
 */
export async function getUncompactedChunkBytes(): Promise<bigint> {
  const [row] = await db()
    .select({value: sql<bigint>`coalesce(sum(${logChunks.byteLen}), 0)`.mapWith(BigInt)})
    .from(logChunks);

  return row?.value ?? 0n;
}

export interface ChunkStats {
  count: number;
  maxSeq: number;
  uncompressedBytes: number;
}

/**
 * Aggregate of a stream's chunks: row count, highest `seq`, and total stored bytes.
 * Compaction reads this once before uploading, both to stamp object metadata and as the
 * baseline its streamed totals are checked against before the chunk rows are deleted.
 */
export async function chunkStats(streamId: string): Promise<ChunkStats> {
  const [row] = await db()
    .select({
      count: sql<number>`count(*)::int`,
      maxSeq: sql<number>`coalesce(max(${logChunks.seq}), 0)::int`,
      uncompressedBytes: sql<string>`coalesce(sum(${logChunks.byteLen}), 0)::text`,
    })
    .from(logChunks)
    .where(eq(logChunks.streamId, streamId));

  return {
    count: row?.count ?? 0,
    maxSeq: row?.maxSeq ?? 0,
    uncompressedBytes: Number(row?.uncompressedBytes ?? '0'),
  };
}
