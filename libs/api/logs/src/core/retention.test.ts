import {Buffer} from 'node:buffer';
import {eq, sql} from 'drizzle-orm';
import * as objectStorage from '#api/object-storage.js';
import {headObject, putObjectBytes} from '#api/object-storage.js';
import {config} from '#config.js';
import {logObjectKey} from '#core/entities/log-object.js';
import {db} from '#db/db.js';
import {attemptStreams} from '#db/schema/attempt-streams.js';
import {jobAccounting} from '#db/schema/job-accounting.js';
import * as streams from '#db/streams.js';
import {jobAccountingFactory} from '#test/factories/job-accounting.js';
import {arrangeClosedStream, type ClosedStreamIdentity} from '#test/fixtures/closed-stream.js';
import {ndjsonBody, outputLine} from '#test/fixtures/ndjson.js';
import {findAccounting, findStream, listChunks} from '#test/queries.js';
import {runRetentionSweep} from './retention.js';

function newIdentity(overrides: Partial<ClosedStreamIdentity> = {}): ClosedStreamIdentity {
  return {
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    attempt: 1,
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    ...overrides,
  };
}

function sweep(overrides: Partial<Parameters<typeof runRetentionSweep>[0]> = {}) {
  return runRetentionSweep({
    retentionDays: 90,
    batchLimit: 100,
    timeBudgetMs: 60_000,
    maxIterations: 100,
    ...overrides,
  });
}

function attemptPrefix(identity: ClosedStreamIdentity): string {
  return logObjectKey(config.LOG_STORAGE_S3_PREFIX, identity);
}

async function backdateClosedAt(streamId: string, interval: string): Promise<void> {
  await db()
    .update(attemptStreams)
    .set({closedAt: sql`now() - ${interval}::interval`})
    .where(eq(attemptStreams.id, streamId));
}

async function backdateAccountingUpdatedAt(jobId: string, interval: string): Promise<void> {
  await db()
    .update(jobAccounting)
    .set({updatedAt: sql`now() - ${interval}::interval`})
    .where(eq(jobAccounting.jobId, jobId));
}

async function setObjectKey(streamId: string, objectKey: string): Promise<void> {
  await db().update(attemptStreams).set({objectKey}).where(eq(attemptStreams.id, streamId));
}

async function putObject(key: string, body: Buffer): Promise<void> {
  await putObjectBytes(key, body);
}

async function objectExists(key: string): Promise<boolean> {
  return (await headObject(key)) !== null;
}

describe('runRetentionSweep', () => {
  it('deletes a past-horizon compacted stream: object, row, chunks, and accounting all gone', async () => {
    const id = newIdentity();
    const stream = await arrangeClosedStream(id);
    const key = `${attemptPrefix(id)}/${crypto.randomUUID()}`;
    const tailKey = `${key}.tail`;
    await putObject(key, Buffer.from('compacted'));
    await putObject(tailKey, Buffer.from('tail'));
    await setObjectKey(stream.id, key);
    await backdateClosedAt(stream.id, '100 days');
    await jobAccountingFactory.create({jobId: id.jobId, workspaceId: id.workspaceId});
    await backdateAccountingUpdatedAt(id.jobId, '100 days');

    await sweep();

    expect(await findStream(id)).toBeNull();
    expect(await listChunks(stream.id)).toHaveLength(0);
    expect(await objectExists(key)).toBe(false);
    expect(await objectExists(tailKey)).toBe(false);
    expect(await findAccounting(id.jobId)).toBeNull();
  });

  it('is idempotent: a second run over the same data deletes nothing and does not throw', async () => {
    const id = newIdentity();
    const stream = await arrangeClosedStream(id);
    await backdateClosedAt(stream.id, '100 days');
    await sweep();

    const second = await sweep();

    expect(await findStream(id)).toBeNull();
    expect(second.failed).toBe(0);
  });

  it('tolerates a recorded object that was never uploaded (NoSuchKey) and still deletes the row', async () => {
    const id = newIdentity();
    const stream = await arrangeClosedStream(id);
    await setObjectKey(stream.id, `${attemptPrefix(id)}/never-uploaded`);
    await backdateClosedAt(stream.id, '100 days');

    const result = await sweep();

    expect(await findStream(id)).toBeNull();
    expect(result.failed).toBe(0);
  });

  it('never touches an open stream, even an ancient one', async () => {
    const id = newIdentity();
    await db().transaction((tx) => streams.getOrCreateAttemptStream(tx, id));

    await sweep();

    expect(await findStream(id)).not.toBeNull();
  });

  it('prunes accounting only once the job has no remaining streams', async () => {
    const shared = {
      jobId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
    };
    const expired = newIdentity({...shared, stepId: crypto.randomUUID()});
    const fresh = newIdentity({...shared, stepId: crypto.randomUUID()});
    const expiredStream = await arrangeClosedStream(expired);
    const freshStream = await arrangeClosedStream(fresh);
    await backdateClosedAt(expiredStream.id, '100 days');
    await jobAccountingFactory.create({jobId: shared.jobId, workspaceId: shared.workspaceId});
    await backdateAccountingUpdatedAt(shared.jobId, '100 days');

    await sweep();

    expect(await findStream(expired)).toBeNull();
    expect(await findStream(fresh)).not.toBeNull();
    expect(await findAccounting(shared.jobId)).not.toBeNull();

    await backdateClosedAt(freshStream.id, '100 days');
    await sweep();

    expect(await findStream(fresh)).toBeNull();
    expect(await findAccounting(shared.jobId)).toBeNull();
  });

  it('deletes a closed-but-never-compacted stream (object_key null)', async () => {
    const id = newIdentity();
    const stream = await arrangeClosedStream(id, {chunks: [ndjsonBody(outputLine('x'))]});
    await backdateClosedAt(stream.id, '100 days');

    const result = await sweep();

    expect(await findStream(id)).toBeNull();
    expect(await listChunks(stream.id)).toHaveLength(0);
    expect(result.failed).toBe(0);
  });

  it('keeps the row when prefix deletion fails, so a later sweep can rediscover the object', async () => {
    const poison = newIdentity();
    const healthy = newIdentity();
    const poisonStream = await arrangeClosedStream(poison);
    const healthyStream = await arrangeClosedStream(healthy);
    const poisonKey = `${attemptPrefix(poison)}/${crypto.randomUUID()}`;
    await putObject(poisonKey, Buffer.from('poison'));
    await setObjectKey(poisonStream.id, poisonKey);
    await backdateClosedAt(poisonStream.id, '200 days');
    await backdateClosedAt(healthyStream.id, '100 days');
    const poisonPrefix = `${attemptPrefix(poison)}/`;
    const realDeleteObjectsByPrefix = objectStorage.deleteObjectsByPrefix;
    vi.spyOn(objectStorage, 'deleteObjectsByPrefix').mockImplementation((prefix) =>
      prefix === poisonPrefix
        ? Promise.reject(new Error('object delete failed'))
        : realDeleteObjectsByPrefix(prefix),
    );

    const result = await sweep({batchLimit: 1});

    expect(await findStream(poison)).not.toBeNull();
    expect(await objectExists(poisonKey)).toBe(true);
    expect(await findStream(healthy)).toBeNull();
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });

  it('deletes the whole attempt prefix, reclaiming a lost compaction attempt orphan leaf', async () => {
    const id = newIdentity();
    const stream = await arrangeClosedStream(id);
    const winner = `${attemptPrefix(id)}/${crypto.randomUUID()}`;
    const orphan = `${attemptPrefix(id)}/${crypto.randomUUID()}`;
    await putObject(winner, Buffer.from('winner'));
    await putObject(orphan, Buffer.from('orphan-leaf'));
    await setObjectKey(stream.id, winner);
    await backdateClosedAt(stream.id, '100 days');

    await sweep();

    expect(await findStream(id)).toBeNull();
    expect(await objectExists(winner)).toBe(false);
    expect(await objectExists(orphan)).toBe(false);
  });

  it('does not starve a younger healthy stream behind a row whose delete keeps failing', async () => {
    const poison = newIdentity();
    const healthy = newIdentity();
    const poisonStream = await arrangeClosedStream(poison);
    const healthyStream = await arrangeClosedStream(healthy);
    const poisonKey = `${attemptPrefix(poison)}/${crypto.randomUUID()}`;
    await putObject(poisonKey, Buffer.from('poison'));
    await setObjectKey(poisonStream.id, poisonKey);
    await backdateClosedAt(poisonStream.id, '200 days');
    await backdateClosedAt(healthyStream.id, '100 days');
    const realDeleteExpiredStream = streams.deleteExpiredStream;
    vi.spyOn(streams, 'deleteExpiredStream').mockImplementation((tx, params) =>
      params.streamId === poisonStream.id
        ? Promise.reject(new Error('poison row delete'))
        : realDeleteExpiredStream(tx, params),
    );

    const result = await sweep({batchLimit: 1});

    expect(await findStream(healthy)).toBeNull();
    expect(await findStream(poison)).not.toBeNull();
    expect(await objectExists(poisonKey)).toBe(false);
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });

  it('self-heals a row delete failure after the object prefix was already deleted', async () => {
    const id = newIdentity();
    const stream = await arrangeClosedStream(id);
    const key = `${attemptPrefix(id)}/${crypto.randomUUID()}`;
    await putObject(key, Buffer.from('compacted'));
    await setObjectKey(stream.id, key);
    await backdateClosedAt(stream.id, '300 days');
    vi.spyOn(streams, 'deleteExpiredStream').mockImplementationOnce(() =>
      Promise.reject(new Error('row delete failed')),
    );

    const failed = await sweep({batchLimit: 1});

    expect(await objectExists(key)).toBe(false);
    expect(await findStream(id)).not.toBeNull();
    expect(failed.failed).toBe(1);

    const recovered = await sweep({batchLimit: 1});

    expect(await findStream(id)).toBeNull();
    expect(recovered.failed).toBe(0);
  });

  it('re-cleans and deletes a stream when compaction publishes after the first prefix cleanup', async () => {
    const id = newIdentity();
    const stream = await arrangeClosedStream(id, {chunks: [ndjsonBody(outputLine('x'))]});
    const key = `${attemptPrefix(id)}/${crypto.randomUUID()}`;
    await backdateClosedAt(stream.id, '100 days');
    const realDeleteExpiredStream = streams.deleteExpiredStream;
    let calls = 0;
    vi.spyOn(streams, 'deleteExpiredStream').mockImplementation(async (tx, params) => {
      calls += 1;
      if (calls === 1 && params.streamId === stream.id) {
        await tx
          .update(attemptStreams)
          .set({objectKey: key})
          .where(eq(attemptStreams.id, stream.id));
        await putObject(key, Buffer.from('compacted'));
      }
      return realDeleteExpiredStream(tx, params);
    });

    const result = await sweep();

    expect(await findStream(id)).toBeNull();
    expect(await objectExists(key)).toBe(false);
    expect(result.deleted).toBe(1);
    expect(result.raced).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('does not starve a younger stream when reloading a raced row fails', async () => {
    const poison = newIdentity();
    const healthy = newIdentity();
    const poisonStream = await arrangeClosedStream(poison);
    const healthyStream = await arrangeClosedStream(healthy);
    await backdateClosedAt(poisonStream.id, '200 days');
    await backdateClosedAt(healthyStream.id, '100 days');
    const realDeleteExpiredStream = streams.deleteExpiredStream;
    vi.spyOn(streams, 'deleteExpiredStream').mockImplementation((tx, params) =>
      params.streamId === poisonStream.id
        ? Promise.resolve({deleted: false, jobId: null})
        : realDeleteExpiredStream(tx, params),
    );
    const realGetAttemptStreamById = streams.getAttemptStreamById;
    vi.spyOn(streams, 'getAttemptStreamById').mockImplementation((streamId) =>
      streamId === poisonStream.id
        ? Promise.reject(new Error('reload failed'))
        : realGetAttemptStreamById(streamId),
    );

    const result = await sweep({batchLimit: 1});

    expect(await findStream(poison)).not.toBeNull();
    expect(await findStream(healthy)).toBeNull();
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });

  it('does not reset a live job budget: deletes its expired streams but keeps fresh accounting', async () => {
    const id = newIdentity();
    const stream = await arrangeClosedStream(id);
    await backdateClosedAt(stream.id, '100 days');
    await jobAccountingFactory.create({jobId: id.jobId, workspaceId: id.workspaceId});

    await sweep();

    expect(await findStream(id)).toBeNull();
    expect(await findAccounting(id.jobId)).not.toBeNull();
  });

  it('stops immediately and reports timedOut when the time budget is already spent', async () => {
    const id = newIdentity();
    const stream = await arrangeClosedStream(id);
    await backdateClosedAt(stream.id, '100 days');

    const result = await sweep({timeBudgetMs: 0, now: () => 1_000});

    expect(result.timedOut).toBe(true);
    expect(await findStream(id)).not.toBeNull();
  });

  it('stops mid-batch on the budget, deleting what it reached and leaving the rest', async () => {
    const drained = newIdentity();
    const remaining = newIdentity();
    const drainedStream = await arrangeClosedStream(drained);
    const remainingStream = await arrangeClosedStream(remaining);
    await backdateClosedAt(drainedStream.id, '200 days');
    await backdateClosedAt(remainingStream.id, '100 days');
    // Keep the first stream inside the budget, then make the per-stream check stop the second.
    let calls = 0;
    const clock = () => (++calls <= 3 ? 0 : 1_000);

    const result = await sweep({timeBudgetMs: 1, now: clock});

    expect(result.timedOut).toBe(true);
    expect(result.deleted).toBe(1);
    expect(await findStream(drained)).toBeNull();
    expect(await findStream(remaining)).not.toBeNull();
  });
});

describe('deleteExpiredStream (compaction-race guard)', () => {
  it('skips the row when object_key changed after observation, so the published object is not orphaned', async () => {
    const id = newIdentity();
    const stream = await arrangeClosedStream(id, {chunks: [ndjsonBody(outputLine('x'))]});
    await setObjectKey(stream.id, 'logs/compaction/published');

    const outcome = await db().transaction((tx) =>
      streams.deleteExpiredStream(tx, {streamId: stream.id, observedObjectKey: null}),
    );

    expect(outcome.deleted).toBe(false);
    expect(await findStream(id)).not.toBeNull();
  });

  it('deletes the row when the observed object_key still matches', async () => {
    const id = newIdentity();
    const stream = await arrangeClosedStream(id);
    await setObjectKey(stream.id, 'logs/compaction/key');

    const outcome = await db().transaction((tx) =>
      streams.deleteExpiredStream(tx, {
        streamId: stream.id,
        observedObjectKey: 'logs/compaction/key',
      }),
    );

    expect(outcome.deleted).toBe(true);
    expect(outcome.jobId).toBe(id.jobId);
    expect(await findStream(id)).toBeNull();
  });
});
