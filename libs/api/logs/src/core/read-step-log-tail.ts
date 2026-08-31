import {gunzipSync} from 'node:zlib';
import {compactedTailObjectKey, getObjectBytes} from '#api/object-storage.js';
import type {AttemptStream} from '#core/entities/attempt-stream.js';
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

/**
 * Reads one exact step attempt as bounded plain text. Hot streams are walked backwards by
 * chunk sequence; closed streams use the compaction tail artifact and fall back to a full
 * object ring buffer while older compacted rows are being migrated.
 */
export async function readStepLogTail(
  params: ReadStepLogTailParams,
): Promise<StepLogTailRead | null> {
  const stream = await getStreamByStepAttempt({stepId: params.stepId, attempt: params.attempt});
  if (!stream) return null;

  const tailLines = normalizeTailLines(params.tailLines);
  if (stream.objectKey) return readColdTail(stream, stream.objectKey, tailLines);

  const hot = await readHotTail(stream, tailLines);
  if (hot.content.length === 0 && stream.state === 'closed') {
    // Compaction publishes the key and deletes chunks in one transaction. If this read loaded
    // the pre-publish row and then saw the post-publish empty chunk set, retry on the cold path.
    const refreshed = await getAttemptStreamById(stream.id);
    if (refreshed?.objectKey) return readColdTail(refreshed, refreshed.objectKey, tailLines);
  }
  return hot;
}

function normalizeTailLines(value: number | undefined): number {
  if (value === undefined) return DEFAULT_STEP_LOG_TAIL_LINES;
  return Math.min(MAX_STEP_LOG_TAIL_LINES, Math.max(1, Math.trunc(value)));
}

async function readHotTail(stream: AttemptStream, tailLines: number): Promise<StepLogTailRead> {
  const tail = new ReverseLogTail(tailLines, MAX_STEP_LOG_TAIL_BYTES);
  let beforeSeq: number | undefined;
  let stopped = false;

  while (!stopped) {
    const page = await readChunksReverse({
      streamId: stream.id,
      ...(beforeSeq === undefined ? {} : {beforeSeq}),
      limit: CHUNK_PAGE_SIZE,
    });
    if (page.length === 0) break;
    for (const row of page) {
      if (!tail.addChunk(row.data)) {
        stopped = true;
        break;
      }
    }
    if (stopped || page.length < CHUNK_PAGE_SIZE) break;
    beforeSeq = page.at(-1)?.seq;
  }

  return {content: tail.finish().content};
}

async function readColdTail(
  stream: AttemptStream,
  objectKey: string,
  tailLines: number,
): Promise<StepLogTailRead> {
  const tailObject = await getObjectBytes(compactedTailObjectKey(objectKey));
  if (tailObject !== null) {
    const bounded = new ForwardLogTail(tailLines, MAX_STEP_LOG_TAIL_BYTES);
    bounded.addChunk(gunzipSync(tailObject));
    const result = bounded.finish();
    return withKnownLineCount(result.content, stream.lineCount);
  }

  const fullObject = await getObjectBytes(objectKey);
  if (fullObject === null) {
    throw new Error(`Compacted log object ${objectKey} is missing`);
  }
  const fallback = new ForwardLogTail(tailLines, MAX_STEP_LOG_TAIL_BYTES);
  fallback.addChunk(gunzipSync(fullObject));
  const result = fallback.finish();
  return {
    content: result.content,
    totalLines: stream.lineCount ?? result.totalLines,
  };
}

function withKnownLineCount(content: string, lineCount: number | null): StepLogTailRead {
  return lineCount === null ? {content} : {content, totalLines: lineCount};
}
