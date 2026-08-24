import {type LogsModuleClient, logsInterModuleContract} from '@shipfox/api-logs-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {
  createInMemoryInterModuleTransport,
  type InterModuleTransport,
} from '@shipfox/node-module/inter-module';
import {appendLogs} from '#core/append-logs.js';
import {createLogsInterModulePresentation} from '#presentation/inter-module.js';
import {ndjsonBody, outputLine} from '#test/fixtures/ndjson.js';
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
