import {type LogRecord, parseLogRecordLine, type ServerLogRecord} from '@shipfox/api-logs-dto';
import {appendLogs} from '#core/append-logs.js';
import {appendServerRecords} from '#core/append-server-records.js';
import {LeaseStreamMismatchError, MalformedLogChunkError} from '#core/errors.js';
import {jobAccountingFactory} from '#test/factories/job-accounting.js';
import {ndjsonBody, outputLine} from '#test/fixtures/ndjson.js';
import {findAccounting, findStream, listChunks, listStreamClosedEvents} from '#test/queries.js';

const metricsMocks = vi.hoisted(() => {
  const counters = new Map<string, {add: ReturnType<typeof vi.fn>}>();
  const add = (name: string) => {
    const counter = {add: vi.fn()};
    counters.set(name, counter);
    return counter;
  };
  return {counters, add};
});

vi.mock('#metrics/instance.js', () => ({
  bytesIngestedCount: metricsMocks.add('bytesIngestedCount'),
  bytesStoredCount: metricsMocks.add('bytesStoredCount'),
  recordAppendedCount: metricsMocks.add('recordAppendedCount'),
  streamClosedCount: metricsMocks.add('streamClosedCount'),
  streamOpenedCount: metricsMocks.add('streamOpenedCount'),
}));

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

function outputRecord(data: string, stream: 'stdout' | 'stderr' = 'stdout'): ServerLogRecord {
  return {v: 1, ts: 1, type: 'output', stream, data};
}

function endRecord(totalBytes: number): ServerLogRecord {
  return {v: 1, ts: 1, type: 'end', total_bytes: totalBytes};
}

function recordsToBody(records: ServerLogRecord[]): Buffer {
  return Buffer.from(records.map((record) => `${JSON.stringify(record)}\n`).join(''));
}

function recordsFromChunks(chunks: Awaited<ReturnType<typeof listChunks>>): LogRecord[] {
  return chunks.flatMap((chunk) =>
    chunk.data.toString('utf8').split('\n').filter(Boolean).map(parseLogRecordLine),
  );
}

async function allowLargeLogBudget(ctx: Ctx): Promise<void> {
  await jobAccountingFactory.create({
    jobId: ctx.jobId,
    workspaceId: ctx.workspaceId,
    startedAt: new Date(Date.now() - 5 * 60_000),
  });
}

describe('appendServerRecords', () => {
  describe('tail offset-CAS', () => {
    it('stores one server chunk and extends committed_length on a first append', async () => {
      const ctx = newCtx();
      const body = recordsToBody([outputRecord('hello\n')]);

      const result = await appendServerRecords({
        ...ctx,
        attempt: 1,
        records: [outputRecord('hello\n')],
      });

      expect(result).toEqual({committedLength: body.length, capped: false});
      const stream = await findStream({...ctx, attempt: 1});
      expect(stream?.committedLength).toBe(body.length);
      const chunks = await listChunks(stream?.id as string);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.origin).toBe('server');
      expect(chunks[0]?.streamOffset).toBe(0);
    });

    it('lands sequential appends at the tail, accumulating committed_length', async () => {
      const ctx = newCtx();
      await allowLargeLogBudget(ctx);
      const first = recordsToBody([outputRecord('one\n')]);
      const second = recordsToBody([outputRecord('two-two\n')]);

      const firstResult = await appendServerRecords({
        ...ctx,
        attempt: 1,
        records: [outputRecord('one\n')],
      });
      const secondResult = await appendServerRecords({
        ...ctx,
        attempt: 1,
        records: [outputRecord('two-two\n')],
      });

      expect(firstResult.committedLength).toBe(first.length);
      expect(secondResult.committedLength).toBe(first.length + second.length);
      const stream = await findStream({...ctx, attempt: 1});
      expect(stream?.committedLength).toBe(first.length + second.length);
      const chunks = await listChunks(stream?.id as string);
      expect(chunks.map((c) => c.origin)).toEqual(['server', 'server']);
      expect(chunks.map((c) => c.streamOffset)).toEqual([0, first.length]);
      expect(recordsFromChunks(chunks)).toEqual([
        {v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'one\n'},
        {v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'two-two\n'},
      ]);
    });

    it('treats an empty records batch as a heartbeat that creates no stream', async () => {
      const ctx = newCtx();

      const result = await appendServerRecords({...ctx, attempt: 1, records: []});

      expect(result).toEqual({committedLength: 0, capped: false});
      expect(await findStream({...ctx, attempt: 1})).toBeNull();
    });

    it('rejects a heartbeat whose identity does not match an existing stream', async () => {
      const ctx = newCtx();
      await appendServerRecords({...ctx, attempt: 1, records: [outputRecord('first\n')]});

      const error = await appendServerRecords({
        ...ctx,
        workspaceId: crypto.randomUUID(),
        attempt: 1,
        records: [],
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LeaseStreamMismatchError);
    });

    it('serializes two concurrent first appends without dropping either', async () => {
      const ctx = newCtx();
      await allowLargeLogBudget(ctx);
      const bodyA = recordsToBody([outputRecord('race-a\n')]);
      const bodyB = recordsToBody([outputRecord('race-b\n')]);

      const results = await Promise.all([
        appendServerRecords({...ctx, attempt: 1, records: [outputRecord('race-a\n')]}),
        appendServerRecords({...ctx, attempt: 1, records: [outputRecord('race-b\n')]}),
      ]);

      // Each call reports the committed length at its own commit point (the tail it
      // landed at), so the two results differ; the stream ends at the sum and both
      // batches are durably stored.
      expect(results.every((r) => !r.capped)).toBe(true);
      const stream = await findStream({...ctx, attempt: 1});
      expect(stream?.committedLength).toBe(bodyA.length + bodyB.length);
      const chunks = await listChunks(stream?.id as string);
      expect(chunks).toHaveLength(2);
      expect(chunks.map((c) => c.origin)).toEqual(['server', 'server']);
    });
  });

  describe('shared CAS axis with the runner path', () => {
    it('appends at the tail of a stream the runner opened', async () => {
      const ctx = newCtx();
      await allowLargeLogBudget(ctx);
      const runnerBody = ndjsonBody(outputLine('runner\n'));
      await appendLogs({...ctx, attempt: 1, offset: 0, body: runnerBody});
      const serverBody = recordsToBody([outputRecord('server\n')]);

      const result = await appendServerRecords({
        ...ctx,
        attempt: 1,
        records: [outputRecord('server\n')],
      });

      expect(result.committedLength).toBe(runnerBody.length + serverBody.length);
      const stream = await findStream({...ctx, attempt: 1});
      const chunks = await listChunks(stream?.id as string);
      expect(chunks.map((c) => c.origin)).toEqual(['runner', 'server']);
      expect(recordsFromChunks(chunks)).toEqual([
        {v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'runner\n'},
        {v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'server\n'},
      ]);
    });

    it('lets the runner continue from the tail a server append advanced', async () => {
      const ctx = newCtx();
      await allowLargeLogBudget(ctx);
      const serverBody = recordsToBody([outputRecord('server\n')]);
      const runnerBody = ndjsonBody(outputLine('runner\n'));
      const serverResult = await appendServerRecords({
        ...ctx,
        attempt: 1,
        records: [outputRecord('server\n')],
      });

      const runnerResult = await appendLogs({
        ...ctx,
        attempt: 1,
        offset: serverResult.committedLength,
        body: runnerBody,
      });

      expect(runnerResult.committedLength).toBe(serverBody.length + runnerBody.length);
      const stream = await findStream({...ctx, attempt: 1});
      const chunks = await listChunks(stream?.id as string);
      expect(chunks.map((c) => c.origin)).toEqual(['server', 'runner']);
    });
  });

  describe('budget accounting', () => {
    it('charges stored bytes for the serialized server body', async () => {
      const ctx = newCtx();
      const body = recordsToBody([outputRecord('abc')]);

      await appendServerRecords({...ctx, attempt: 1, records: [outputRecord('abc')]});

      const accounting = await findAccounting(ctx.jobId);
      expect(accounting?.storedBytesUsed).toBe(body.length);
    });

    it('stays under cap when accrual from elapsed time covers the payload', async () => {
      const ctx = newCtx();
      await allowLargeLogBudget(ctx);

      const result = await appendServerRecords({
        ...ctx,
        attempt: 1,
        records: [outputRecord('x'.repeat(150))],
      });

      expect(result.capped).toBe(false);
      expect((await findAccounting(ctx.jobId))?.cappedAt).toBeNull();
    });
  });

  describe('cap', () => {
    it('caps when the payload crosses the budget, injecting a control tombstone', async () => {
      const ctx = newCtx();

      const result = await appendServerRecords({
        ...ctx,
        attempt: 1,
        records: [outputRecord('x'.repeat(150))],
      });

      expect(result.capped).toBe(true);
      expect((await findAccounting(ctx.jobId))?.cappedAt).not.toBeNull();
      const stream = await findStream({...ctx, attempt: 1});
      const chunks = await listChunks(stream?.id as string);
      expect(chunks.map((c) => c.origin)).toEqual(['server', 'control']);
    });

    it('drops a post-cap batch but still advances committed_length', async () => {
      const ctx = newCtx();
      const first = recordsToBody([outputRecord('x'.repeat(150))]);
      await appendServerRecords({...ctx, attempt: 1, records: [outputRecord('x'.repeat(150))]});
      const straggler = recordsToBody([outputRecord('late\n')]);

      const result = await appendServerRecords({
        ...ctx,
        attempt: 1,
        records: [outputRecord('late\n')],
      });

      expect(result).toEqual({committedLength: first.length + straggler.length, capped: true});
      const stream = await findStream({...ctx, attempt: 1});
      const chunks = await listChunks(stream?.id as string);
      expect(chunks.map((c) => c.origin)).toEqual(['server', 'control']);
    });

    it('does not declared-close when an already-capped job drops an end body', async () => {
      const ctx = newCtx();
      await appendServerRecords({...ctx, attempt: 1, records: [outputRecord('x'.repeat(150))]});

      await appendServerRecords({...ctx, attempt: 1, records: [endRecord(4)]});

      const stream = await findStream({...ctx, attempt: 1});
      expect(stream?.state).toBe('open');
      expect(stream?.closeReason).toBeNull();
      expect(stream?.declaredTotalBytes).toBeNull();
      expect(await listStreamClosedEvents(stream?.id as string)).toHaveLength(0);
    });
  });

  describe('stream lifecycle', () => {
    it('rejects an end record that is not the final record in the batch', async () => {
      const ctx = newCtx();

      const error = await appendServerRecords({
        ...ctx,
        attempt: 1,
        records: [endRecord(4), outputRecord('late\n')],
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MalformedLogChunkError);
      expect(await findStream({...ctx, attempt: 1})).toBeNull();
    });

    it('declared-closes the stream and emits one stream-closed event on an end record', async () => {
      const ctx = newCtx();
      await allowLargeLogBudget(ctx);

      await appendServerRecords({
        ...ctx,
        attempt: 1,
        records: [outputRecord('done\n'), endRecord(12345)],
      });

      const stream = await findStream({...ctx, attempt: 1});
      expect(stream?.state).toBe('closed');
      expect(stream?.closeReason).toBe('declared');
      expect(stream?.truncated).toBe(false);
      expect(stream?.declaredTotalBytes).toBe(12345);
      expect(await listStreamClosedEvents(stream?.id as string)).toHaveLength(1);
    });

    it('drops further output once declared-closed (no new chunk, committed_length frozen)', async () => {
      const ctx = newCtx();
      await allowLargeLogBudget(ctx);
      const end = recordsToBody([endRecord(4)]);
      await appendServerRecords({...ctx, attempt: 1, records: [endRecord(4)]});
      const closed = await findStream({...ctx, attempt: 1});

      const result = await appendServerRecords({
        ...ctx,
        attempt: 1,
        records: [outputRecord('late\n')],
      });

      expect(result.committedLength).toBe(end.length);
      const after = await findStream({...ctx, attempt: 1});
      expect(after?.committedLength).toBe(closed?.committedLength);
      expect(await listChunks(after?.id as string)).toHaveLength(1);
    });

    it('keeps attempts of the same step on independent streams', async () => {
      const ctx = newCtx();
      const a1 = recordsToBody([outputRecord('one\n')]);
      const a2 = recordsToBody([outputRecord('two-two\n')]);

      await appendServerRecords({...ctx, attempt: 1, records: [outputRecord('one\n')]});
      await appendServerRecords({...ctx, attempt: 2, records: [outputRecord('two-two\n')]});

      expect((await findStream({...ctx, attempt: 1}))?.committedLength).toBe(a1.length);
      expect((await findStream({...ctx, attempt: 2}))?.committedLength).toBe(a2.length);
    });
  });

  describe('write-path enforcement', () => {
    it('rejects an invalid record before any row is created', async () => {
      const ctx = newCtx();
      const recordWithoutData: LogRecord = {
        v: 1,
        ts: 1,
        type: 'output',
        stream: 'stdout',
        data: '',
      };

      const error = await appendServerRecords({
        ...ctx,
        attempt: 1,
        records: [recordWithoutData],
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MalformedLogChunkError);
      expect(await findStream({...ctx, attempt: 1})).toBeNull();
    });

    it('rejects a second append whose workspace/project/run does not match the stamped row', async () => {
      const ctx = newCtx();
      await appendServerRecords({...ctx, attempt: 1, records: [outputRecord('first\n')]});

      const error = await appendServerRecords({
        ...ctx,
        projectId: crypto.randomUUID(),
        attempt: 1,
        records: [outputRecord('more\n')],
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LeaseStreamMismatchError);
      const after = await findStream({...ctx, attempt: 1});
      expect(await listChunks(after?.id as string)).toHaveLength(1);
    });

    it('rejects a server batch larger than the configured append body limit', async () => {
      const ctx = newCtx();
      const records = Array.from({length: 5}, () => outputRecord('x'.repeat(16 * 1024)));

      const error = await appendServerRecords({...ctx, attempt: 1, records}).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MalformedLogChunkError);
      expect(error).toHaveProperty('message', expect.stringContaining('append body exceeds'));
      expect(await findStream({...ctx, attempt: 1})).toBeNull();
    });
  });

  describe('byte volume metrics', () => {
    beforeEach(() => {
      for (const counter of metricsMocks.counters.values()) counter.add.mockClear();
    });

    function ingestedAdd() {
      return metricsMocks.counters.get('bytesIngestedCount')?.add;
    }

    function storedAdd() {
      return metricsMocks.counters.get('bytesStoredCount')?.add;
    }

    it('counts the serialized server body once on an in-order append', async () => {
      const ctx = newCtx();
      const body = recordsToBody([outputRecord('hello\n')]);

      await appendServerRecords({...ctx, attempt: 1, records: [outputRecord('hello\n')]});

      expect(ingestedAdd()).toHaveBeenCalledTimes(1);
      expect(ingestedAdd()).toHaveBeenCalledWith(body.length);
      expect(storedAdd()).toHaveBeenCalledTimes(1);
      expect(storedAdd()).toHaveBeenCalledWith(body.length);
    });

    it('counts records by type and reports a declared close', async () => {
      const ctx = newCtx();
      await allowLargeLogBudget(ctx);

      await appendServerRecords({
        ...ctx,
        attempt: 1,
        records: [outputRecord('a\n'), endRecord(4)],
      });

      const recordAppended = metricsMocks.counters.get('recordAppendedCount')?.add;
      expect(recordAppended).toHaveBeenCalledWith(1, {kind: 'output'});
      expect(recordAppended).toHaveBeenCalledWith(1, {kind: 'end'});
      expect(metricsMocks.counters.get('streamClosedCount')?.add).toHaveBeenCalledWith(1, {
        reason: 'declared',
      });
      expect(metricsMocks.counters.get('streamOpenedCount')?.add).toHaveBeenCalledWith(1);
    });

    it('does not count bytes for a cap-dropped straggler as stored', async () => {
      const ctx = newCtx();
      const crossing = recordsToBody([outputRecord('x'.repeat(150))]);
      await appendServerRecords({...ctx, attempt: 1, records: [outputRecord('x'.repeat(150))]});
      const straggler = recordsToBody([outputRecord('late\n')]);

      await appendServerRecords({...ctx, attempt: 1, records: [outputRecord('late\n')]});

      expect(ingestedAdd()).toHaveBeenCalledTimes(2);
      expect(ingestedAdd()).toHaveBeenCalledWith(crossing.length);
      expect(ingestedAdd()).toHaveBeenCalledWith(straggler.length);
      // The server-injected `capped` tombstone chunk never counts as stored bytes either.
      expect(storedAdd()).toHaveBeenCalledTimes(1);
      expect(storedAdd()).toHaveBeenCalledWith(crossing.length);

      const recordAppended = metricsMocks.counters.get('recordAppendedCount')?.add;
      expect(recordAppended).toHaveBeenCalledWith(1, {kind: 'output'});
      expect(recordAppended).toHaveBeenCalledWith(1, {kind: 'capped'});
      expect(recordAppended).toHaveBeenCalledTimes(2);
    });
  });
});
