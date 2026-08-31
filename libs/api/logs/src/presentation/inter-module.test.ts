import {Buffer} from 'node:buffer';
import {type LogsModuleClient, logsInterModuleContract} from '@shipfox/api-logs-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {
  createInMemoryInterModuleTransport,
  type InterModuleTransport,
} from '@shipfox/node-module/inter-module';
import {MockActivityEnvironment} from '@temporalio/testing';
import {compactedTailObjectKey, deleteObject} from '#api/object-storage.js';
import {appendLogs} from '#core/append-logs.js';
import {insertChunk} from '#db/chunks.js';
import {db} from '#db/db.js';
import {getOrCreateAttemptStream} from '#db/streams.js';
import {createLogsInterModulePresentation} from '#presentation/inter-module.js';
import {
  type CompactStreamResult,
  compactStreamActivity,
} from '#temporal/activities/compact-stream.js';
import {arrangeClosedStream} from '#test/fixtures/closed-stream.js';
import {ndjsonBody, outputLine, recordLine} from '#test/fixtures/ndjson.js';
import {findStream, listChunks} from '#test/queries.js';

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

function buildSealedLogsClient(): LogsModuleClient {
  const transport: InterModuleTransport = createInMemoryInterModuleTransport();
  const logs = transport.createClient(logsInterModuleContract);
  transport.register(createLogsInterModulePresentation());
  transport.seal();
  return logs;
}

function runCompaction(streamId: string): Promise<CompactStreamResult> {
  return new MockActivityEnvironment().run(compactStreamActivity, {streamId});
}

describe('logs inter-module presentation', () => {
  it('appends server-origin records through the sealed transport', async () => {
    const ctx = newCtx();
    const logs = buildSealedLogsClient();

    const result = await logs.appendServerRecords({
      ...ctx,
      attempt: 1,
      records: [{v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'hello\n'}],
    });

    expect(result.capped).toBe(false);
    expect(result.committedLength).toBeGreaterThan(0);
    const stream = await findStream({...ctx, attempt: 1});
    expect(stream?.committedLength).toBe(result.committedLength);
    const chunks = await listChunks(stream?.id as string);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.origin).toBe('server');
  });

  it('reads a bounded exact-attempt hot tail through the sealed transport', async () => {
    const ctx = {...newCtx(), attempt: 1};
    const logs = buildSealedLogsClient();
    const firstBody = ndjsonBody(outputLine('one\n'), outputLine('two\n'));
    const secondBody = ndjsonBody(outputLine('three\n'));
    await db().transaction(async (tx) => {
      const stream = await getOrCreateAttemptStream(tx, ctx);
      await insertChunk(tx, {
        streamId: stream.id,
        streamOffset: 0,
        byteLen: firstBody.length,
        data: firstBody,
        origin: 'runner',
      });
      await insertChunk(tx, {
        streamId: stream.id,
        streamOffset: firstBody.length,
        byteLen: secondBody.length,
        data: secondBody,
        origin: 'runner',
      });
    });

    const result = await logs.readStepLogTail({stepId: ctx.stepId, attempt: 1, tailLines: 2});

    expect(result?.content).toContain('two');
    expect(result?.content).toContain('three');
    expect(result?.content).not.toContain('one');
    expect(result?.totalLines).toBeUndefined();
    expect(await logs.readStepLogTail({stepId: ctx.stepId, attempt: 2, tailLines: 2})).toBeNull();
  });

  it('walks reverse chunk pages until the newest hot lines are collected', async () => {
    const ctx = {...newCtx(), attempt: 1};
    const logs = buildSealedLogsClient();
    const chunks = Array.from({length: 70}, (_, index) =>
      ndjsonBody(outputLine(`line-${index}\n`)),
    );

    await db().transaction(async (tx) => {
      const stream = await getOrCreateAttemptStream(tx, ctx);
      let offset = 0;
      for (const data of chunks) {
        await insertChunk(tx, {
          streamId: stream.id,
          streamOffset: offset,
          byteLen: data.length,
          data,
          origin: 'runner',
        });
        offset += data.length;
      }
    });

    const result = await logs.readStepLogTail({stepId: ctx.stepId, attempt: 1, tailLines: 3});

    expect(result?.content).toContain('line-67');
    expect(result?.content).toContain('line-68');
    expect(result?.content).toContain('line-69');
    expect(result?.content).not.toContain('line-0');
  });

  it('reads the same rendered tail from a compacted artifact and returns its line count', async () => {
    const identity = {...newCtx(), attempt: 1};
    const logs = buildSealedLogsClient();
    const stream = await arrangeClosedStream(identity, {
      chunks: [ndjsonBody(outputLine('one\n'), outputLine('two\n'), outputLine('three\n'))],
    });

    const compacted = await runCompaction(stream.id);
    if (compacted.outcome !== 'compacted') throw new Error('expected compacted stream');

    const result = await logs.readStepLogTail({
      stepId: identity.stepId,
      attempt: identity.attempt,
      tailLines: 2,
    });

    expect(result?.content).toContain('two');
    expect(result?.content).toContain('three');
    expect(result?.content).not.toContain('one');
    expect(result?.totalLines).toBe(3);
    await deleteObject(compacted.objectKey);
    await deleteObject(compactedTailObjectKey(compacted.objectKey));
  });

  it('falls back to the full compacted object while a tail artifact is absent', async () => {
    const identity = {...newCtx(), attempt: 1};
    const logs = buildSealedLogsClient();
    const stream = await arrangeClosedStream(identity, {
      chunks: [ndjsonBody(outputLine('one\n'), outputLine('two\n'), outputLine('three\n'))],
    });
    const compacted = await runCompaction(stream.id);
    if (compacted.outcome !== 'compacted') throw new Error('expected compacted stream');

    await deleteObject(compactedTailObjectKey(compacted.objectKey));
    const result = await logs.readStepLogTail({stepId: identity.stepId, attempt: 1, tailLines: 2});

    expect(result?.content).toContain('two');
    expect(result?.content).toContain('three');
    expect(result?.totalLines).toBe(3);
    await deleteObject(compacted.objectKey);
  });

  it('uses the same UTF-8-safe line truncation for hot and cold session records', async () => {
    const row = {timestamp: 1, kind: 'thinking' as const, text: '界'.repeat(10_000)};
    const body = ndjsonBody(recordLine({type: 'agent_session', row}));
    const hotIdentity = {...newCtx(), attempt: 1};
    const coldIdentity = {...newCtx(), attempt: 1};
    const logs = buildSealedLogsClient();

    await db().transaction(async (tx) => {
      const stream = await getOrCreateAttemptStream(tx, hotIdentity);
      await insertChunk(tx, {
        streamId: stream.id,
        streamOffset: 0,
        byteLen: body.length,
        data: body,
        origin: 'runner',
      });
    });
    const coldStream = await arrangeClosedStream(coldIdentity, {chunks: [body]});
    const compacted = await runCompaction(coldStream.id);
    if (compacted.outcome !== 'compacted') throw new Error('expected compacted stream');

    const hot = await logs.readStepLogTail({
      stepId: hotIdentity.stepId,
      attempt: hotIdentity.attempt,
      tailLines: 1,
    });
    const cold = await logs.readStepLogTail({
      stepId: coldIdentity.stepId,
      attempt: coldIdentity.attempt,
      tailLines: 1,
    });

    expect(cold?.content).toBe(hot?.content);
    expect(Buffer.byteLength(hot?.content ?? '', 'utf8')).toBeLessThanOrEqual(8 * 1024);
    expect(hot?.content).not.toContain('\uFFFD');
    await deleteObject(compacted.objectKey);
    await deleteObject(compactedTailObjectKey(compacted.objectKey));
  });

  it('rejects invalid records at the contract boundary without creating a stream', async () => {
    const ctx = newCtx();
    const logs = buildSealedLogsClient();

    await expect(
      logs.appendServerRecords({
        ...ctx,
        attempt: 1,
        // @ts-expect-error deliberately invalid record for the contract test
        records: [{v: 1, ts: 1, type: 'output', stream: 'stdout'}],
      }),
    ).rejects.toThrow();

    expect(await findStream({...ctx, attempt: 1})).toBeNull();
  });

  it('maps known domain errors at the transport boundary', async () => {
    const ctx = newCtx();
    const logs = buildSealedLogsClient();
    await logs.appendServerRecords({
      ...ctx,
      attempt: 1,
      records: [{v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'first\n'}],
    });

    const error = await logs
      .appendServerRecords({
        ...ctx,
        projectId: crypto.randomUUID(),
        attempt: 1,
        records: [{v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'more\n'}],
      })
      .catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(logsInterModuleContract.methods.appendServerRecords, error),
    ).toBe(true);
    expect(error).toMatchObject({code: 'lease-stream-mismatch', details: {}});
  });

  it('keeps a valid oversized batch distinct from malformed records', async () => {
    const ctx = newCtx();
    const logs = buildSealedLogsClient();

    const error = await logs
      .appendServerRecords({
        ...ctx,
        attempt: 1,
        records: Array.from({length: 5}, () => ({
          v: 1 as const,
          ts: 1,
          type: 'output' as const,
          stream: 'stdout' as const,
          data: 'x'.repeat(16 * 1024),
        })),
      })
      .catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(logsInterModuleContract.methods.appendServerRecords, error),
    ).toBe(true);
    expect(error).toMatchObject({
      code: 'append-body-too-large',
      details: {maxBytes: expect.any(Number)},
    });
  });

  it('rejects a server append to a runner-owned stream at the contract boundary', async () => {
    const ctx = newCtx();
    const logs = buildSealedLogsClient();
    await appendLogs({
      ...ctx,
      attempt: 1,
      offset: 0,
      body: ndjsonBody(outputLine('runner\n')),
    });

    const error = await logs
      .appendServerRecords({
        ...ctx,
        attempt: 1,
        records: [{v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'server'}],
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({code: 'runner-writer-active', details: {}});
  });
});
