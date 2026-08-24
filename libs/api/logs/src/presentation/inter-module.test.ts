import {type LogsModuleClient, logsInterModuleContract} from '@shipfox/api-logs-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {
  createInMemoryInterModuleTransport,
  type InterModuleTransport,
} from '@shipfox/node-module/inter-module';
import {createLogsInterModulePresentation} from '#presentation/inter-module.js';
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
});
