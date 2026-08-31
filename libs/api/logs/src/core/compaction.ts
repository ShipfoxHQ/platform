import {Buffer} from 'node:buffer';
import {Readable} from 'node:stream';
import {createGzip} from 'node:zlib';
import {readChunksKeyset} from '#db/chunks.js';
import {ForwardLogTail} from './log-tail.js';

// Chunks are capped at ~256KB each by the runner flush, so a small fixed page count gives a
// predictable memory bound (page x ~256KB) without a byte-budgeted query.
const CHUNK_PAGE_SIZE = 64;

export interface CompactionStreamStats {
  chunkCount: number;
  lastSeq: number;
  uncompressedBytes: number;
  /** Set after the source has been fully consumed; optional for injected test implementations. */
  lineCount?: number;
}

export interface CompactionTailArtifact {
  body: Buffer;
  lineCount: number;
  tailLineCount: number;
}

export interface CompactedGzipStream {
  body: Readable;
  stats: CompactionStreamStats;
  /** Available after `body` has been consumed. */
  tailArtifact?: CompactionTailArtifact;
}

export interface CompactedGzipStreamParams {
  streamId: string;
  /**
   * Invoked once per fetched chunk page (after the read, before the page's bytes flow on).
   * Lets the caller heartbeat off read progress, so the pre-upload phase and a slow first
   * part still emit liveness instead of waiting on the upload's per-part progress event.
   */
  onPage?: () => void;
}

/**
 * Builds a gzip stream of a closed stream's chunk bytes in `seq` order. Keyset-paginates
 * so memory stays flat at any stream size, and fills `stats` as bytes flow so the caller
 * can check the streamed totals against the table before deleting the source rows. A
 * source error is forwarded to the gzip stream, so the upload consuming it rejects rather
 * than silently truncating.
 */
export function compactedGzipStream(params: CompactedGzipStreamParams): CompactedGzipStream {
  const stats: CompactionStreamStats = {chunkCount: 0, lastSeq: 0, uncompressedBytes: 0};
  const tail = new ForwardLogTail();
  const tailArtifact: CompactionTailArtifact = {
    body: Buffer.alloc(0),
    lineCount: 0,
    tailLineCount: 0,
  };

  async function* chunks(): AsyncGenerator<Buffer> {
    let afterSeq = 0;
    while (true) {
      const page = await readChunksKeyset({
        streamId: params.streamId,
        afterSeq,
        limit: CHUNK_PAGE_SIZE,
      });
      if (page.length === 0) break;
      params.onPage?.();
      for (const row of page) {
        stats.chunkCount += 1;
        stats.lastSeq = row.seq;
        stats.uncompressedBytes += row.data.length;
        tail.addChunk(row.data);
        yield row.data;
      }
      afterSeq = page.at(-1)?.seq ?? afterSeq;
      if (page.length < CHUNK_PAGE_SIZE) break;
    }
    const result = tail.finish();
    stats.lineCount = result.totalLines;
    tailArtifact.body = result.ndjson;
    tailArtifact.lineCount = result.totalLines;
    tailArtifact.tailLineCount = result.retainedLines;
  }

  const source = Readable.from(chunks());
  const gzip = createGzip();
  source.once('error', (error) => gzip.destroy(error));
  source.pipe(gzip);

  return {body: gzip, stats, tailArtifact};
}
