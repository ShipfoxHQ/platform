import {Buffer} from 'node:buffer';
import {Readable} from 'node:stream';
import {createGzip, gunzipSync} from 'node:zlib';
import {MockActivityEnvironment} from '@temporalio/testing';
import {eq} from 'drizzle-orm';
import {
  compactedTailObjectKey,
  deleteObject,
  listObjectKeys,
  getObjectBytes as readObjectBytes,
  headObject as readObjectHead,
} from '#api/object-storage.js';
import {config} from '#config.js';
import {compactedGzipStream} from '#core/compaction.js';
import {logObjectKey} from '#core/entities/log-object.js';
import {db} from '#db/db.js';
import {attemptStreams} from '#db/schema/attempt-streams.js';
import * as streamDb from '#db/streams.js';
import {getAttemptStreamById, setObjectKeyAndDeleteChunks} from '#db/streams.js';
import {arrangeClosedStream, type ClosedStreamIdentity} from '#test/fixtures/closed-stream.js';
import {ndjsonBody, outputLine} from '#test/fixtures/ndjson.js';
import {listChunks} from '#test/queries.js';
import {
  type CompactStreamResult,
  compactStreamActivity,
  createCompactStreamActivity,
} from './compact-stream.js';

const compactedGzipStreamMock = vi.fn<typeof compactedGzipStream>();
const setObjectKeyAndDeleteChunksMock = vi.fn<typeof setObjectKeyAndDeleteChunks>();
const compactStreamActivityWithMocks = createCompactStreamActivity({
  compactedGzipStream: compactedGzipStreamMock,
  setObjectKeyAndDeleteChunks: setObjectKeyAndDeleteChunksMock,
});

function newIdentity(): ClosedStreamIdentity {
  return {
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    attempt: 1,
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
  };
}

function runCompaction(
  streamId: string,
  activity = compactStreamActivity,
): Promise<CompactStreamResult> {
  return new MockActivityEnvironment().run(activity, {streamId});
}

async function getObjectBytes(key: string): Promise<Buffer> {
  const body = await readObjectBytes(key);
  if (!body) throw new Error('object has no body');
  return body;
}

function headObject(key: string) {
  return readObjectHead(key);
}

// Every attempt's object lives under the stream's stable prefix; listing it proves both the
// winner's object and that losing/failed attempts left nothing behind.
function listKeysUnderStream(identity: ClosedStreamIdentity): Promise<string[]> {
  return listObjectKeys(`${logObjectKey(config.LOG_STORAGE_S3_PREFIX, identity)}/`);
}

function compactedKey(result: CompactStreamResult): string {
  if (result.outcome !== 'compacted') throw new Error(`expected compacted, got ${result.outcome}`);
  return result.objectKey;
}

describe('compactStreamActivity', () => {
  beforeEach(() => {
    compactedGzipStreamMock.mockReset();
    setObjectKeyAndDeleteChunksMock.mockReset();
    compactedGzipStreamMock.mockImplementation(compactedGzipStream);
    setObjectKeyAndDeleteChunksMock.mockImplementation(setObjectKeyAndDeleteChunks);
  });

  it('compacts many chunks into one gzip object and deletes the chunk rows', async () => {
    const chunks = [outputLine('one\n'), outputLine('two\n'), outputLine('three\n')].map((l) =>
      ndjsonBody(l),
    );
    const identity = newIdentity();
    const stream = await arrangeClosedStream(identity, {chunks});

    const result = await runCompaction(stream.id);

    const key = compactedKey(result);
    expect(key.startsWith(`${logObjectKey(config.LOG_STORAGE_S3_PREFIX, identity)}/`)).toBe(true);
    const after = await getAttemptStreamById(stream.id);
    expect(after?.objectKey).toBe(key);
    expect(after?.lineCount).toBe(3);
    expect(await listChunks(stream.id)).toHaveLength(0);
    const tailKey = compactedTailObjectKey(key);
    expect(await listKeysUnderStream(identity)).toEqual([key, tailKey]);

    const head = await headObject(key);
    expect(head?.contentEncoding).toBe('gzip');
    expect(head?.contentType).toBe('application/x-ndjson');
    expect(head?.metadata.stream_id).toBe(stream.id);
    expect(head?.metadata.chunk_count).toBe('3');

    expect(gunzipSync(await getObjectBytes(key))).toEqual(Buffer.concat(chunks));
    expect(gunzipSync(await getObjectBytes(tailKey))).toEqual(Buffer.concat(chunks));
    const tailHead = await headObject(tailKey);
    expect(tailHead?.contentEncoding).toBe('gzip');
    expect(tailHead?.contentType).toBe('application/x-ndjson');
    expect(tailHead?.metadata.line_count).toBe('3');
    expect(tailHead?.metadata.tail_line_count).toBe('3');

    await deleteObject(key);
    await deleteObject(tailKey);
  });

  it('preserves seq order across many keyset pages (more chunks than one page)', async () => {
    // CHUNK_PAGE_SIZE is 64; 150 chunks forces the keyset loop across three page seams, so a
    // wrong afterSeq advance or page-boundary off-by-one would drop, dup, or reorder bytes.
    const chunks = Array.from({length: 150}, (_, i) => ndjsonBody(outputLine(`line-${i}\n`)));
    const identity = newIdentity();
    const stream = await arrangeClosedStream(identity, {chunks});

    const result = await runCompaction(stream.id);

    const key = compactedKey(result);
    expect(result.outcome === 'compacted' && result.chunkCount).toBe(150);
    expect(gunzipSync(await getObjectBytes(key))).toEqual(Buffer.concat(chunks));
    expect(gunzipSync(await getObjectBytes(compactedTailObjectKey(key)))).toEqual(
      Buffer.concat(chunks),
    );
    expect((await headObject(key))?.metadata.chunk_count).toBe('150');
    expect((await headObject(compactedTailObjectKey(key)))?.metadata.tail_line_count).toBe('150');
    expect(await listChunks(stream.id)).toHaveLength(0);

    await deleteObject(key);
    await deleteObject(compactedTailObjectKey(key));
  });

  it('keeps the cold tail bounded while retaining the newest records', async () => {
    const lines = Array.from({length: 2_100}, (_, i) => outputLine(`line-${i}\n`));
    const identity = newIdentity();
    const stream = await arrangeClosedStream(identity, {chunks: [ndjsonBody(...lines)]});

    const result = await runCompaction(stream.id);

    const key = compactedKey(result);
    const tailBytes = gunzipSync(await getObjectBytes(compactedTailObjectKey(key)));
    const tailLines = tailBytes.toString('utf8').trimEnd().split('\n');
    expect(tailLines).toHaveLength(2_000);
    expect(tailLines[0]).toContain('line-100');
    expect(tailLines.at(-1)).toContain('line-2099');
    expect(tailBytes.length).toBeLessThanOrEqual(256 * 1024);
    expect((await getAttemptStreamById(stream.id))?.lineCount).toBe(2_100);

    await deleteObject(key);
    await deleteObject(compactedTailObjectKey(key));
  });

  it('is a no-op on re-run once the object key is set (idempotent / crash-safe)', async () => {
    const stream = await arrangeClosedStream(newIdentity(), {
      chunks: [ndjsonBody(outputLine('x\n'))],
    });
    const key = compactedKey(await runCompaction(stream.id));

    const result = await runCompaction(stream.id);

    expect(result.outcome).toBe('already-compacted');
    await deleteObject(key);
    await deleteObject(compactedTailObjectKey(key));
  });

  it('produces a valid empty object for a stream with no chunks', async () => {
    const stream = await arrangeClosedStream(newIdentity(), {chunks: []});

    const result = await runCompaction(stream.id);

    const key = compactedKey(result);
    expect(gunzipSync(await getObjectBytes(key))).toHaveLength(0);
    expect((await headObject(key))?.metadata.chunk_count).toBe('0');
    expect(gunzipSync(await getObjectBytes(compactedTailObjectKey(key)))).toHaveLength(0);
    expect((await headObject(compactedTailObjectKey(key)))?.metadata.line_count).toBe('0');

    await deleteObject(key);
    await deleteObject(compactedTailObjectKey(key));
  });

  it('compacts a tombstone-only (timeout-closed) stream', async () => {
    const stream = await arrangeClosedStream(newIdentity(), {tombstone: true});

    const result = await runCompaction(stream.id);

    const key = compactedKey(result);
    expect(gunzipSync(await getObjectBytes(key)).toString('utf8')).toContain(
      '"type":"runner_lost"',
    );

    await deleteObject(key);
    await deleteObject(compactedTailObjectKey(key));
  });

  it('returns gone when the stream row no longer exists', async () => {
    const result = await runCompaction(crypto.randomUUID());

    expect(result.outcome).toBe('gone');
  });

  it('throws, deletes its upload, and keeps the chunks when streamed totals disagree', async () => {
    const identity = newIdentity();
    const stream = await arrangeClosedStream(identity, {
      chunks: [ndjsonBody(outputLine('a\n')), ndjsonBody(outputLine('b\n'))],
    });
    // Upload a (wrong) empty body whose stats claim zero chunks; the table has two.
    compactedGzipStreamMock.mockReturnValueOnce({
      body: Readable.from([]).pipe(createGzip()),
      stats: {chunkCount: 0, lastSeq: 0, uncompressedBytes: 0},
      tailArtifact: Promise.resolve({body: Buffer.alloc(0), lineCount: 0, tailLineCount: 0}),
    });

    await expect(runCompaction(stream.id, compactStreamActivityWithMocks)).rejects.toThrow(
      'integrity check',
    );

    const after = await getAttemptStreamById(stream.id);
    expect(after?.objectKey).toBeNull();
    expect(await listChunks(stream.id)).toHaveLength(2);
    expect(await listKeysUnderStream(identity)).toEqual([]);
  });

  it('keeps published objects when the publication acknowledgement is lost', async () => {
    const identity = newIdentity();
    const stream = await arrangeClosedStream(identity, {chunks: [ndjsonBody(outputLine('x\n'))]});
    setObjectKeyAndDeleteChunksMock.mockImplementationOnce(async (_tx, params) => {
      // Commit the publication independently, then emulate a client-side failure after the
      // database acknowledgement is lost. The activity must not delete the durable copies.
      await db().transaction((tx) => setObjectKeyAndDeleteChunks(tx, params));
      throw new Error('publication acknowledgement lost');
    });

    await expect(runCompaction(stream.id, compactStreamActivityWithMocks)).rejects.toThrow(
      'publication acknowledgement lost',
    );

    const after = await getAttemptStreamById(stream.id);
    expect(after?.objectKey).not.toBeNull();
    const key = after?.objectKey as string;
    expect(await listKeysUnderStream(identity)).toEqual([key, compactedTailObjectKey(key)]);
    await deleteObject(key);
    await deleteObject(compactedTailObjectKey(key));
  });

  it('leaves an upload for reconciliation when the post-error reload fails', async () => {
    const identity = newIdentity();
    const stream = await arrangeClosedStream(identity, {chunks: [ndjsonBody(outputLine('x\n'))]});
    const realGetAttemptStreamById = streamDb.getAttemptStreamById;
    let reloads = 0;
    vi.spyOn(streamDb, 'getAttemptStreamById').mockImplementation((streamId) => {
      reloads += 1;
      return reloads === 2
        ? Promise.reject(new Error('database unavailable'))
        : realGetAttemptStreamById(streamId);
    });
    // Force a post-upload failure. The failed cleanup reload leaves the uploaded object behind,
    // and the next activity attempt must publish a winner without overwriting the old key.
    compactedGzipStreamMock.mockReturnValueOnce({
      body: Readable.from([]).pipe(createGzip()),
      stats: {chunkCount: 0, lastSeq: 0, uncompressedBytes: 0},
      tailArtifact: Promise.resolve({body: Buffer.alloc(0), lineCount: 0, tailLineCount: 0}),
    });

    await expect(runCompaction(stream.id, compactStreamActivityWithMocks)).rejects.toThrow(
      'integrity check',
    );
    vi.restoreAllMocks();

    const orphanKeys = await listKeysUnderStream(identity);
    expect(orphanKeys).toHaveLength(1);
    const orphanKey = orphanKeys[0];
    expect(orphanKey).toBeDefined();

    const result = await runCompaction(stream.id, compactStreamActivityWithMocks);

    expect(result.outcome).toBe('compacted');
    const key = compactedKey(result);
    expect(key).not.toBe(orphanKey);
    expect(await listKeysUnderStream(identity)).toEqual(
      expect.arrayContaining([orphanKey, key, compactedTailObjectKey(key)]),
    );
    for (const uploadedKey of await listKeysUnderStream(identity)) {
      await deleteObject(uploadedKey);
    }
  });

  it('deletes its own upload and reports superseded when another attempt won the publish', async () => {
    const identity = newIdentity();
    const stream = await arrangeClosedStream(identity, {chunks: [ndjsonBody(outputLine('x\n'))]});
    // Simulate a concurrent attempt publishing first: the guarded update matches 0 rows while
    // the row still exists.
    setObjectKeyAndDeleteChunksMock.mockResolvedValueOnce({updated: false});

    const result = await runCompaction(stream.id, compactStreamActivityWithMocks);

    expect(result.outcome).toBe('superseded');
    expect(await listKeysUnderStream(identity)).toEqual([]);
  });

  it('deletes the orphaned object and reports retention-raced when the row vanished mid-upload', async () => {
    const identity = newIdentity();
    const stream = await arrangeClosedStream(identity, {chunks: [ndjsonBody(outputLine('x\n'))]});
    // Simulate retention hard-deleting the row mid-upload: the guarded update finds 0 rows.
    setObjectKeyAndDeleteChunksMock.mockImplementationOnce(async (_tx, params) => {
      await db().delete(attemptStreams).where(eq(attemptStreams.id, params.streamId));
      return {updated: false};
    });

    const result = await runCompaction(stream.id, compactStreamActivityWithMocks);

    expect(result.outcome).toBe('retention-raced');
    expect(await listKeysUnderStream(identity)).toEqual([]);
  });
});
