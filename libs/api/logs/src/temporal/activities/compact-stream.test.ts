import {Buffer} from 'node:buffer';
import {Readable} from 'node:stream';
import {createGzip, gunzipSync} from 'node:zlib';
import {GetObjectCommand, HeadObjectCommand, ListObjectsV2Command} from '@aws-sdk/client-s3';
import {MockActivityEnvironment} from '@temporalio/testing';
import {eq} from 'drizzle-orm';
import {deleteObject, s3Client} from '#api/object-storage.js';
import {config} from '#config.js';
import {compactedGzipStream} from '#core/compaction.js';
import {logObjectKey} from '#core/entities/log-object.js';
import {db} from '#db/db.js';
import {attemptStreams} from '#db/schema/attempt-streams.js';
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
  const res = await s3Client().send(
    new GetObjectCommand({Bucket: config.LOG_STORAGE_S3_BUCKET, Key: key}),
  );
  if (!res.Body) throw new Error('object has no body');
  return Buffer.from(await res.Body.transformToByteArray());
}

function headObject(key: string) {
  return s3Client().send(new HeadObjectCommand({Bucket: config.LOG_STORAGE_S3_BUCKET, Key: key}));
}

// Every attempt's object lives under the stream's stable prefix; listing it proves both the
// winner's object and that losing/failed attempts left nothing behind.
async function listKeysUnderStream(identity: ClosedStreamIdentity): Promise<string[]> {
  const res = await s3Client().send(
    new ListObjectsV2Command({
      Bucket: config.LOG_STORAGE_S3_BUCKET,
      Prefix: `${logObjectKey(config.LOG_STORAGE_S3_PREFIX, identity)}/`,
    }),
  );
  return (res.Contents ?? []).map((object) => object.Key ?? '');
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
    expect(await listChunks(stream.id)).toHaveLength(0);
    expect(await listKeysUnderStream(identity)).toEqual([key]);

    const head = await headObject(key);
    expect(head.ContentEncoding).toBe('gzip');
    expect(head.ContentType).toBe('application/x-ndjson');
    expect(head.Metadata?.stream_id).toBe(stream.id);
    expect(head.Metadata?.chunk_count).toBe('3');

    expect(gunzipSync(await getObjectBytes(key))).toEqual(Buffer.concat(chunks));

    await deleteObject(key);
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
    expect((await headObject(key)).Metadata?.chunk_count).toBe('150');
    expect(await listChunks(stream.id)).toHaveLength(0);

    await deleteObject(key);
  });

  it('is a no-op on re-run once the object key is set (idempotent / crash-safe)', async () => {
    const stream = await arrangeClosedStream(newIdentity(), {
      chunks: [ndjsonBody(outputLine('x\n'))],
    });
    const key = compactedKey(await runCompaction(stream.id));

    const result = await runCompaction(stream.id);

    expect(result.outcome).toBe('already-compacted');
    await deleteObject(key);
  });

  it('produces a valid empty object for a stream with no chunks', async () => {
    const stream = await arrangeClosedStream(newIdentity(), {chunks: []});

    const result = await runCompaction(stream.id);

    const key = compactedKey(result);
    expect(gunzipSync(await getObjectBytes(key))).toHaveLength(0);
    expect((await headObject(key)).Metadata?.chunk_count).toBe('0');

    await deleteObject(key);
  });

  it('compacts a tombstone-only (timeout-closed) stream', async () => {
    const stream = await arrangeClosedStream(newIdentity(), {tombstone: true});

    const result = await runCompaction(stream.id);

    const key = compactedKey(result);
    expect(gunzipSync(await getObjectBytes(key)).toString('utf8')).toContain(
      '"type":"runner_lost"',
    );

    await deleteObject(key);
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
    });

    await expect(runCompaction(stream.id, compactStreamActivityWithMocks)).rejects.toThrow(
      'integrity check',
    );

    const after = await getAttemptStreamById(stream.id);
    expect(after?.objectKey).toBeNull();
    expect(await listChunks(stream.id)).toHaveLength(2);
    expect(await listKeysUnderStream(identity)).toEqual([]);
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
