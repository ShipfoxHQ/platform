import {Buffer} from 'node:buffer';
import {createGunzip, gunzipSync} from 'node:zlib';
import {compactedTailObjectKey, getObjectBytes, getObjectStream} from '#api/object-storage.js';
import type {AttemptStream} from '#core/entities/attempt-stream.js';
import {CompactedLogUnavailableError} from '#core/errors.js';
import {
  DEFAULT_STEP_LOG_TAIL_LINES,
  ForwardLogTail,
  MAX_STEP_LOG_TAIL_BYTES,
  MAX_STEP_LOG_TAIL_LINES,
  ReverseLogTail,
} from '#core/log-tail.js';
import {readChunksReverse} from '#db/chunks.js';
import {getAttemptStreamById, getStreamByStepAttempt} from '#db/streams.js';

const CHUNK_PAGE_SIZE = 64;

export interface StepLogTailRead {
  content: string;
  totalLines?: number;
}

export interface ReadStepLogTailParams {
  stepId: string;
  attempt: number;
  tailLines?: number;
}

export interface ReadStepLogTailDependencies {
  compactedTailObjectKey: typeof compactedTailObjectKey;
  getAttemptStreamById: typeof getAttemptStreamById;
  getObjectBytes: typeof getObjectBytes;
  getObjectStream: typeof getObjectStream;
  getStreamByStepAttempt: typeof getStreamByStepAttempt;
  readChunksReverse: typeof readChunksReverse;
}

const defaultDependencies: ReadStepLogTailDependencies = {
  compactedTailObjectKey,
  getAttemptStreamById,
  getObjectBytes,
  getObjectStream,
  getStreamByStepAttempt,
  readChunksReverse,
};

/**
 * Reads one exact step attempt as bounded plain text. Hot streams are walked backwards by
 * chunk sequence; closed streams use the compaction tail artifact and fall back to a full
 * object ring buffer while older compacted rows are being migrated.
 */
export async function readStepLogTail(
  params: ReadStepLogTailParams,
  dependencies: ReadStepLogTailDependencies = defaultDependencies,
): Promise<StepLogTailRead | null> {
  const stream = await dependencies.getStreamByStepAttempt({
    stepId: params.stepId,
    attempt: params.attempt,
  });
  if (!stream) return null;

  const tailLines = normalizeTailLines(params.tailLines);
  if (stream.objectKey) return readColdTail(stream, stream.objectKey, tailLines, dependencies);

  const hot = await readHotTail(stream, tailLines, dependencies);
  if (stream.state === 'closed') {
    // Compaction publishes the key and deletes chunks in one transaction. Refresh every closed
    // hot read because a multi-page reverse walk can see the publish between page queries even
    // when its first page already returned content.
    const refreshed = await dependencies.getAttemptStreamById(stream.id);
    if (refreshed?.objectKey)
      return readColdTail(refreshed, refreshed.objectKey, tailLines, dependencies);
  }
  return hot;
}

function normalizeTailLines(value: number | undefined): number {
  if (value === undefined) return DEFAULT_STEP_LOG_TAIL_LINES;
  return Math.min(MAX_STEP_LOG_TAIL_LINES, Math.max(1, Math.trunc(value)));
}

async function readHotTail(
  stream: AttemptStream,
  tailLines: number,
  dependencies: ReadStepLogTailDependencies,
): Promise<StepLogTailRead> {
  const tail = new ReverseLogTail(tailLines, MAX_STEP_LOG_TAIL_BYTES);
  let beforeSeq: number | undefined;
  let stopped = false;

  while (!stopped) {
    const page = await dependencies.readChunksReverse({
      streamId: stream.id,
      ...(beforeSeq === undefined ? {} : {beforeSeq}),
      limit: CHUNK_PAGE_SIZE,
      maxBytes: MAX_STEP_LOG_TAIL_BYTES,
    });
    if (page.rows.length === 0) break;
    for (const row of page.rows) {
      if (!tail.addChunk(row.data)) {
        stopped = true;
        break;
      }
    }
    if (stopped || !page.hasMore) break;
    beforeSeq = page.rows.at(-1)?.seq;
  }

  return {content: tail.finish().content};
}

async function readColdTail(
  stream: AttemptStream,
  objectKey: string,
  tailLines: number,
  dependencies: ReadStepLogTailDependencies,
): Promise<StepLogTailRead | null> {
  const tailObject = await dependencies.getObjectBytes(
    dependencies.compactedTailObjectKey(objectKey),
  );
  if (tailObject !== null) {
    const bounded = new ForwardLogTail(tailLines, MAX_STEP_LOG_TAIL_BYTES);
    bounded.addChunk(gunzipSync(tailObject));
    const result = bounded.finish();
    return withKnownLineCount(result.content, stream.lineCount);
  }

  const fullObject = await dependencies.getObjectStream(objectKey);
  if (fullObject === null) {
    const refreshed = await dependencies.getAttemptStreamById(stream.id);
    if (!refreshed) return null;
    if (refreshed.objectKey && refreshed.objectKey !== objectKey) {
      return readColdTail(refreshed, refreshed.objectKey, tailLines, dependencies);
    }
    if (!refreshed.objectKey) return readHotTail(refreshed, tailLines, dependencies);
    throw new CompactedLogUnavailableError();
  }
  const fallback = new ForwardLogTail(tailLines, MAX_STEP_LOG_TAIL_BYTES);
  const gunzip = createGunzip();
  fullObject.body.once('error', (error) => gunzip.destroy(error));
  fullObject.body.pipe(gunzip);
  for await (const chunk of gunzip) fallback.addChunk(Buffer.from(chunk));
  const result = fallback.finish();
  return {
    content: result.content,
    totalLines: stream.lineCount ?? result.totalLines,
  };
}

function withKnownLineCount(content: string, lineCount: number | null): StepLogTailRead {
  return lineCount === null ? {content} : {content, totalLines: lineCount};
}
