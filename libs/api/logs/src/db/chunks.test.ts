import {appendLogs} from '#core/append-logs.js';
import {
  endLine,
  groupStartLine,
  ndjsonBody,
  outputLine,
  outputOfBytes,
} from '#test/fixtures/ndjson.js';
import {findStream, listChunks} from '#test/queries.js';
import {getUncompactedChunkBytes} from './chunks.js';

interface Ctx {
  jobId: string;
  stepId: string;
  workspaceId: string;
  projectId: string;
  workflowRunAttemptId: string;
}

function newCtx(): Ctx {
  return {
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
  };
}

function chunkBytesOf(streamId: string): Promise<number> {
  return listChunks(streamId).then((chunks) =>
    chunks.reduce((total, chunk) => total + chunk.byteLen, 0),
  );
}

describe('getUncompactedChunkBytes', () => {
  it('sums chunk bytes across open and declared-closed streams, control chunks included', async () => {
    const before = await getUncompactedChunkBytes();
    const open = newCtx();
    const closed = newCtx();
    // 150 payload bytes cross the 100-byte test budget, so this stream also gets a `capped`
    // control chunk: the gauge must count it, since compaction will move it to storage too.
    const crossingBody = outputOfBytes(150);
    await appendLogs({...open, attempt: 1, offset: 0, body: crossingBody});
    const closedBody = ndjsonBody(outputLine('done\n'), groupStartLine('g1', 'Build'), endLine(4));
    await appendLogs({...closed, attempt: 1, offset: 0, body: closedBody});

    const openStream = await findStream({...open, attempt: 1});
    const closedStream = await findStream({...closed, attempt: 1});
    const expected =
      (await chunkBytesOf(openStream?.id as string)) +
      (await chunkBytesOf(closedStream?.id as string));

    const after = await getUncompactedChunkBytes();

    expect(after - before).toBe(BigInt(expected));
    expect(closedStream?.state).toBe('closed');
  });
});
