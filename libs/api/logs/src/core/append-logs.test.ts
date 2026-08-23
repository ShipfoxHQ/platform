import {type LogRecord, parseLogRecordLine} from '@shipfox/api-logs-dto';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {defineInterModulePresentation} from '@shipfox/inter-module';
import {createFakeInterModuleClients} from '@shipfox/node-module/inter-module/testing';
import {appendLogs} from '#core/append-logs.js';
import {LeaseStreamMismatchError, MalformedLogChunkError, OffsetGapError} from '#core/errors.js';
import {jobAccountingFactory} from '#test/factories/job-accounting.js';
import {
  endLine,
  groupStartLine,
  ndjsonBody,
  outputLine,
  outputOfBytes,
  recordLine,
  sessionLine,
} from '#test/fixtures/ndjson.js';
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

async function allowLargeLogBudget(ctx: Ctx): Promise<void> {
  await jobAccountingFactory.create({
    jobId: ctx.jobId,
    workspaceId: ctx.workspaceId,
    startedAt: new Date(Date.now() - 5 * 60_000),
  });
}

function recordsFromChunks(chunks: Awaited<ReturnType<typeof listChunks>>): LogRecord[] {
  return chunks.flatMap((chunk) =>
    chunk.data.toString('utf8').split('\n').filter(Boolean).map(parseLogRecordLine),
  );
}

describe('appendLogs', () => {
  describe('offset-CAS', () => {
    it('extends committed_length and stores one runner chunk on an in-order append', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('hello\n'));

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(result).toEqual({committedLength: body.length, capped: false});
      const stream = await findStream({...ctx, attempt: 1});
      expect(stream?.committedLength).toBe(body.length);
      const chunks = await listChunks(stream?.id as string);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.origin).toBe('runner');
    });

    it('acks a re-sent (offset < committed) append without storing a new chunk', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('hello\n'));
      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(result).toEqual({committedLength: body.length, capped: false});
      const stream = await findStream({...ctx, attempt: 1});
      expect(await listChunks(stream?.id as string)).toHaveLength(1);
    });

    it('rejects a gap (offset > committed) with the committed length', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('hello\n'));
      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      const error = await appendLogs({
        ...ctx,
        attempt: 1,
        offset: body.length + 5,
        body: ndjsonBody(outputLine('more\n')),
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OffsetGapError);
      expect((error as OffsetGapError).committedLength).toBe(body.length);
    });

    it('rejects a straddling append (offset before committed but extending past it)', async () => {
      const ctx = newCtx();
      const first = ndjsonBody(outputLine('hello\n'));
      await appendLogs({...ctx, attempt: 1, offset: 0, body: first});

      const error = await appendLogs({
        ...ctx,
        attempt: 1,
        offset: first.length - 2,
        body: ndjsonBody(outputLine('more\n')),
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OffsetGapError);
      expect((error as OffsetGapError).committedLength).toBe(first.length);
    });

    it('treats an empty body as a heartbeat that creates no stream', async () => {
      const ctx = newCtx();

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body: ndjsonBody()});

      expect(result).toEqual({committedLength: 0, capped: false});
      expect(await findStream({...ctx, attempt: 1})).toBeNull();
    });
  });

  describe('agent_session', () => {
    it('stores a normalized session line as one runner chunk and leaves the stream open', async () => {
      const ctx = newCtx();
      await allowLargeLogBudget(ctx);
      const body = ndjsonBody(sessionLine('{"type":"x"}'));

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(result).toEqual({committedLength: body.length, capped: false});
      const stream = await findStream({...ctx, attempt: 1});
      expect(stream?.state).toBe('open');
      const chunks = await listChunks(stream?.id as string);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.origin).toBe('runner');
      expect(recordsFromChunks(chunks)).toEqual([
        {
          v: 1,
          ts: 1,
          type: 'agent_session',
          row: {
            kind: 'raw',
            timestamp: 1,
            label: 'Unknown session entry: x',
            raw: '{"type":"x"}',
          },
        },
      ]);
    });

    it('stores parsed pi session rows in append order', async () => {
      const ctx = newCtx();
      await allowLargeLogBudget(ctx);
      const first = sessionLine(
        JSON.stringify({type: 'session', id: 'session-1', cwd: '/workspace'}),
      );
      const second = sessionLine(
        JSON.stringify({type: 'message', message: {role: 'assistant', content: 'Done.'}}),
      );
      const body = ndjsonBody(first, second);

      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      const stream = await findStream({...ctx, attempt: 1});
      const rows = recordsFromChunks(await listChunks(stream?.id as string)).map((record) => {
        expect(record.type).toBe('agent_session');
        return record.type === 'agent_session' ? record.row : null;
      });
      expect(rows).toEqual([
        {
          kind: 'lifecycle',
          timestamp: 1,
          label: 'Session started',
          detail: 'session-1 · /workspace',
          meta: [],
          tone: 'default',
          terminalFailure: false,
        },
        {
          kind: 'message',
          timestamp: 1,
          role: 'assistant',
          label: 'assistant',
          meta: [],
          text: 'Done.',
          terminalFailure: false,
        },
      ]);
    });

    it('selects the Claude parser from the step harness', async () => {
      const ctx = newCtx();
      await allowLargeLogBudget(ctx);
      const workflows = createFakeInterModuleClients({
        workflows: defineInterModulePresentation(workflowsInterModuleContract, {
          startRunFromTrigger: vi.fn(),
          startDevRun: vi.fn(),
          resolveWorkflowRunTriggerReference: vi.fn(),
          deliverEventToJobListener: vi.fn(),
          getStepLogContext: () => ({harness: 'claude' as const}),
          getLeasedAgentToolContext: vi.fn(),
        }),
      }).workflows;
      const body = ndjsonBody(
        sessionLine(
          JSON.stringify({
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [{type: 'tool_use', id: 'tool-1', name: 'Read', input: {path: 'a.ts'}}],
            },
          }),
        ),
        endLine(0),
      );

      await appendLogs({...ctx, attempt: 1, offset: 0, body}, workflows);

      const stream = await findStream({...ctx, attempt: 1});
      const rows = recordsFromChunks(await listChunks(stream?.id as string)).flatMap((record) =>
        record.type === 'agent_session' ? [record.row] : [],
      );
      expect(rows).toEqual([
        {
          kind: 'tool-call',
          timestamp: 1,
          id: 'tool-1',
          name: 'Read',
          input: '{\n  "path": "a.ts"\n}',
        },
      ]);
    });

    it('reports Claude re-prompts as turns and labels the re-prompt as platform input', async () => {
      const ctx = newCtx();
      await jobAccountingFactory.create({
        jobId: ctx.jobId,
        workspaceId: ctx.workspaceId,
        startedAt: new Date(Date.now() - 60 * 60_000),
      });
      const workflows = createFakeInterModuleClients({
        workflows: defineInterModulePresentation(workflowsInterModuleContract, {
          startRunFromTrigger: vi.fn(),
          startDevRun: vi.fn(),
          resolveWorkflowRunTriggerReference: vi.fn(),
          deliverEventToJobListener: vi.fn(),
          getStepLogContext: () => ({harness: 'claude' as const}),
          getLeasedAgentToolContext: vi.fn(),
        }),
      }).workflows;
      const init = sessionLine(
        JSON.stringify({type: 'system', subtype: 'init', session_id: 'session-1'}),
      );
      const result = (text: string) =>
        sessionLine(JSON.stringify({type: 'result', subtype: 'success', result: text}));
      const reprompt = sessionLine(
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content:
              'The previous turn ended without setting required workflow outputs: answer. ' +
              'Call set_output for each missing key, then provide your final response.',
          },
        }),
      );
      const body = ndjsonBody(
        init,
        result('first response'),
        reprompt,
        init,
        result('second response'),
        reprompt,
        init,
        result('final response'),
        endLine(0),
      );

      await appendLogs({...ctx, attempt: 1, offset: 0, body}, workflows);

      const stream = await findStream({...ctx, attempt: 1});
      const rows = recordsFromChunks(await listChunks(stream?.id as string)).flatMap((record) =>
        record.type === 'agent_session' ? [record.row] : [],
      );
      const lifecycleRows = rows.filter(
        (row): row is Extract<NonNullable<(typeof rows)[number]>, {kind: 'lifecycle'}> =>
          row?.kind === 'lifecycle',
      );
      const messageRows = rows.filter(
        (row): row is Extract<NonNullable<(typeof rows)[number]>, {kind: 'message'}> =>
          row?.kind === 'message',
      );

      expect(lifecycleRows.map((row) => row.label)).toEqual([
        'Session started',
        'Turn 1 completed',
        'Turn 2 started',
        'Turn 2 completed',
        'Turn 3 started',
        'Session completed',
      ]);
      expect(
        lifecycleRows.filter((row) => row.label.startsWith('Turn ')).map((row) => row.meta),
      ).toEqual([
        [{label: 'turn', value: '1'}],
        [{label: 'turn', value: '2'}],
        [{label: 'turn', value: '2'}],
        [{label: 'turn', value: '3'}],
      ]);
      expect(messageRows.map((row) => ({role: row.role, label: row.label}))).toEqual([
        {role: 'platform', label: 'platform'},
        {role: 'platform', label: 'platform'},
      ]);
    });

    it('continues Claude turn context across append requests', async () => {
      const ctx = newCtx();
      await jobAccountingFactory.create({
        jobId: ctx.jobId,
        workspaceId: ctx.workspaceId,
        startedAt: new Date(Date.now() - 60 * 60_000),
      });
      const workflows = createFakeInterModuleClients({
        workflows: defineInterModulePresentation(workflowsInterModuleContract, {
          startRunFromTrigger: vi.fn(),
          startDevRun: vi.fn(),
          resolveWorkflowRunTriggerReference: vi.fn(),
          deliverEventToJobListener: vi.fn(),
          getStepLogContext: () => ({harness: 'claude' as const}),
          getLeasedAgentToolContext: vi.fn(),
        }),
      }).workflows;
      const init = sessionLine(
        JSON.stringify({type: 'system', subtype: 'init', session_id: 'session-1'}),
      );
      const result = sessionLine(
        JSON.stringify({type: 'result', subtype: 'success', result: 'response'}),
      );
      const reprompt = sessionLine(
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content:
              'The previous turn ended without setting required workflow outputs: answer. ' +
              'Call set_output for each missing key, then provide your final response.',
          },
        }),
      );
      const first = ndjsonBody(init, result);
      const second = ndjsonBody(reprompt, init, result, endLine(0));

      await appendLogs({...ctx, attempt: 1, offset: 0, body: first}, workflows);
      await appendLogs({...ctx, attempt: 1, offset: first.length, body: second}, workflows);

      const stream = await findStream({...ctx, attempt: 1});
      const rows = recordsFromChunks(await listChunks(stream?.id as string)).flatMap((record) =>
        record.type === 'agent_session' ? [record.row] : [],
      );
      const lifecycleRows = rows.filter(
        (row): row is Extract<NonNullable<(typeof rows)[number]>, {kind: 'lifecycle'}> =>
          row?.kind === 'lifecycle',
      );

      expect(lifecycleRows.map((row) => row.label)).toEqual([
        'Session started',
        'Turn 1 completed',
        'Turn 2 started',
        'Session completed',
      ]);
      expect(stream).toMatchObject({
        claudeHasInit: true,
        claudeSessionId: 'session-1',
        claudeTurn: 2,
        claudePendingResult: null,
      });
    });

    it('folds a tool-use summary across append requests before storing the row', async () => {
      const ctx = newCtx();
      await allowLargeLogBudget(ctx);
      const workflows = createFakeInterModuleClients({
        workflows: defineInterModulePresentation(workflowsInterModuleContract, {
          startRunFromTrigger: vi.fn(),
          startDevRun: vi.fn(),
          resolveWorkflowRunTriggerReference: vi.fn(),
          deliverEventToJobListener: vi.fn(),
          getStepLogContext: () => ({harness: 'claude' as const}),
          getLeasedAgentToolContext: vi.fn(),
        }),
      }).workflows;
      const first = ndjsonBody(
        sessionLine(
          JSON.stringify({
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [
                {type: 'tool_use', id: 'tool-1', name: 'Read', input: {file_path: 'src/a.ts'}},
              ],
            },
          }),
        ),
      );
      const second = ndjsonBody(
        sessionLine(
          JSON.stringify({
            type: 'tool_use_summary',
            summary: 'Read the source file.',
            preceding_tool_use_ids: ['tool-1'],
          }),
        ),
        endLine(0),
      );

      await appendLogs({...ctx, attempt: 1, offset: 0, body: first}, workflows);
      await appendLogs({...ctx, attempt: 1, offset: first.length, body: second}, workflows);

      const stream = await findStream({...ctx, attempt: 1});
      const rows = recordsFromChunks(await listChunks(stream?.id as string)).flatMap((record) =>
        record.type === 'agent_session' ? [record.row] : [],
      );

      expect(rows).toEqual([
        {
          kind: 'tool-call',
          timestamp: expect.any(Number),
          id: 'tool-1',
          name: 'Read',
          input: '{\n  "file_path": "src/a.ts"\n}',
          summary: 'Read the source file.',
        },
      ]);
      expect(stream?.claudePendingToolRows).toEqual([]);
    });

    it('does not duplicate parsed rows on a retried append', async () => {
      const ctx = newCtx();
      await allowLargeLogBudget(ctx);
      const body = ndjsonBody(sessionLine(JSON.stringify({type: 'session', id: 'session-1'})));
      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      const stream = await findStream({...ctx, attempt: 1});
      expect(recordsFromChunks(await listChunks(stream?.id as string))).toHaveLength(1);
    });

    it('does not store normalized session records when a capped append is dropped', async () => {
      const ctx = newCtx();
      const first = outputOfBytes(150);
      await appendLogs({...ctx, attempt: 1, offset: 0, body: first});
      const straggler = ndjsonBody(sessionLine(JSON.stringify({type: 'session', id: 'dropped'})));

      await appendLogs({...ctx, attempt: 1, offset: first.length, body: straggler});

      const stream = await findStream({...ctx, attempt: 1});
      expect(recordsFromChunks(await listChunks(stream?.id as string))).not.toContainEqual(
        expect.objectContaining({type: 'agent_session'}),
      );
    });

    it('rejects a session line over LOG_MAX_SESSION_LINE_BYTES before any stream is created', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(sessionLine('x'.repeat(600)));

      const error = await appendLogs({...ctx, attempt: 1, offset: 0, body}).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MalformedLogChunkError);
      expect(await findStream({...ctx, attempt: 1})).toBeNull();
    });
  });

  describe('budget accounting', () => {
    it('charges stored bytes, envelope and control records included', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('abc'), groupStartLine('g1', 'Build'));

      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      const accounting = await findAccounting(ctx.jobId);
      expect(accounting?.storedBytesUsed).toBe(body.length);
    });

    it('stays under cap when accrual from elapsed time covers the payload', async () => {
      const ctx = newCtx();
      await jobAccountingFactory.create({
        jobId: ctx.jobId,
        workspaceId: ctx.workspaceId,
        startedAt: new Date(Date.now() - 5 * 60_000),
      });

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body: outputOfBytes(150)});

      expect(result.capped).toBe(false);
      expect((await findAccounting(ctx.jobId))?.cappedAt).toBeNull();
    });
  });

  describe('cap', () => {
    it('caps when the payload crosses the budget, injecting a control tombstone', async () => {
      const ctx = newCtx();

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body: outputOfBytes(150)});

      expect(result.capped).toBe(true);
      expect((await findAccounting(ctx.jobId))?.cappedAt).not.toBeNull();
      const stream = await findStream({...ctx, attempt: 1});
      const chunks = await listChunks(stream?.id as string);
      expect(chunks.map((c) => c.origin)).toEqual(['runner', 'control']);
    });

    it('drops a post-cap straggler but still advances committed_length', async () => {
      const ctx = newCtx();
      const first = outputOfBytes(150);
      await appendLogs({...ctx, attempt: 1, offset: 0, body: first});
      const straggler = ndjsonBody(outputLine('late\n'));

      const result = await appendLogs({...ctx, attempt: 1, offset: first.length, body: straggler});

      expect(result).toEqual({committedLength: first.length + straggler.length, capped: true});
      const stream = await findStream({...ctx, attempt: 1});
      const chunks = await listChunks(stream?.id as string);
      expect(chunks.map((c) => c.origin)).toEqual(['runner', 'control']);
    });

    it('does not cap when stored bytes land exactly on the budget', async () => {
      const ctx = newCtx();
      const body = outputOfBytes(9);
      // Test env base budget is 100 bytes; pre-fill so this append lands used == allowed.
      await jobAccountingFactory.create({
        jobId: ctx.jobId,
        workspaceId: ctx.workspaceId,
        storedBytesUsed: 100 - body.length,
        startedAt: new Date(),
      });

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(result.capped).toBe(false);
      expect((await findAccounting(ctx.jobId))?.cappedAt).toBeNull();
    });
  });

  describe('stream lifecycle', () => {
    it('declared-closes the stream and emits one stream-closed event on an end record', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('done\n'), endLine(12345));

      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      const stream = await findStream({...ctx, attempt: 1});
      expect(stream?.state).toBe('closed');
      expect(stream?.closeReason).toBe('declared');
      expect(stream?.truncated).toBe(false);
      expect(stream?.declaredTotalBytes).toBe(12345);
      expect(stream?.closedAt).not.toBeNull();
      expect(await listStreamClosedEvents(stream?.id as string)).toHaveLength(1);
    });

    it('is idempotent: a re-sent end body neither re-closes nor emits a second event', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('done\n'), endLine(10));
      await appendLogs({...ctx, attempt: 1, offset: 0, body});
      const stream = await findStream({...ctx, attempt: 1});

      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(await listStreamClosedEvents(stream?.id as string)).toHaveLength(1);
    });

    it('drops further output once declared-closed (no new chunk, committed_length frozen)', async () => {
      const ctx = newCtx();
      // End-only body so the single stored chunk stays under the 100-byte test budget
      // (an extra output line would trip the cap and add a tombstone chunk).
      const end = ndjsonBody(endLine(4));
      await appendLogs({...ctx, attempt: 1, offset: 0, body: end});
      const closed = await findStream({...ctx, attempt: 1});

      const result = await appendLogs({
        ...ctx,
        attempt: 1,
        offset: end.length,
        body: ndjsonBody(outputLine('late\n')),
      });

      expect(result.committedLength).toBe(end.length);
      const after = await findStream({...ctx, attempt: 1});
      expect(after?.committedLength).toBe(closed?.committedLength);
      expect(await listChunks(after?.id as string)).toHaveLength(1);
    });

    it('declared-closes when one body both crosses the budget and ends', async () => {
      const ctx = newCtx();
      // 150 payload bytes cross the 100-byte test budget, but the crossing chunk is still
      // stored in full; the same body carries the end, so the stream declared-closes.
      const body = ndjsonBody(outputLine('x'.repeat(150)), endLine(4));

      const result = await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(result.capped).toBe(true);
      const stream = await findStream({...ctx, attempt: 1});
      expect(stream?.state).toBe('closed');
      expect(stream?.closeReason).toBe('declared');
      expect(stream?.truncated).toBe(false);
      expect((await listChunks(stream?.id as string)).map((c) => c.origin)).toEqual([
        'runner',
        'control',
      ]);
      expect(await listStreamClosedEvents(stream?.id as string)).toHaveLength(1);
    });

    it('does not declared-close when an already-capped job drops the end body', async () => {
      const ctx = newCtx();
      // Cap the job first (150 payload bytes cross the 100-byte budget), then send the end
      // body: it is dropped, so the stream is not whole and must stay open for the sweep.
      const first = outputOfBytes(150);
      await appendLogs({...ctx, attempt: 1, offset: 0, body: first});
      const end = ndjsonBody(endLine(4));

      const result = await appendLogs({...ctx, attempt: 1, offset: first.length, body: end});

      expect(result.capped).toBe(true);
      const stream = await findStream({...ctx, attempt: 1});
      expect(stream?.state).toBe('open');
      expect(stream?.closeReason).toBeNull();
      expect(stream?.declaredTotalBytes).toBeNull();
      // The dropped end body persisted nothing: still just the runner chunk + cap tombstone.
      expect(await listChunks(stream?.id as string)).toHaveLength(2);
      expect(await listStreamClosedEvents(stream?.id as string)).toHaveLength(0);
    });

    it('keeps attempts of the same step on independent streams', async () => {
      const ctx = newCtx();
      const a1 = ndjsonBody(outputLine('one\n'));
      const a2 = ndjsonBody(outputLine('two-two\n'));

      await appendLogs({...ctx, attempt: 1, offset: 0, body: a1});
      await appendLogs({...ctx, attempt: 2, offset: 0, body: a2});

      expect((await findStream({...ctx, attempt: 1}))?.committedLength).toBe(a1.length);
      expect((await findStream({...ctx, attempt: 2}))?.committedLength).toBe(a2.length);
    });
  });

  describe('concurrency and isolation', () => {
    it('serializes two concurrent first appends at offset 0 into one chunk', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('race\n'));

      const results = await Promise.all([
        appendLogs({...ctx, attempt: 1, offset: 0, body}),
        appendLogs({...ctx, attempt: 1, offset: 0, body}),
      ]);

      expect(results.every((r) => r.committedLength === body.length)).toBe(true);
      const stream = await findStream({...ctx, attempt: 1});
      expect(await listChunks(stream?.id as string)).toHaveLength(1);
    });

    it('claims the cap once when two steps of one job cross the budget concurrently', async () => {
      const ctx = newCtx();
      const stepA = crypto.randomUUID();
      const stepB = crypto.randomUUID();

      await Promise.all([
        appendLogs({...ctx, stepId: stepA, attempt: 1, offset: 0, body: outputOfBytes(80)}),
        appendLogs({...ctx, stepId: stepB, attempt: 1, offset: 0, body: outputOfBytes(80)}),
      ]);

      expect((await findAccounting(ctx.jobId))?.cappedAt).not.toBeNull();
      const streamA = await findStream({jobId: ctx.jobId, stepId: stepA, attempt: 1});
      const streamB = await findStream({jobId: ctx.jobId, stepId: stepB, attempt: 1});
      const controls = [
        ...(await listChunks(streamA?.id as string)),
        ...(await listChunks(streamB?.id as string)),
      ].filter((c) => c.origin === 'control');
      expect(controls).toHaveLength(1);
    });

    it('rejects a second append whose lease workspace/project/run does not match the stamped row', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('first\n'));
      await appendLogs({...ctx, attempt: 1, offset: 0, body});
      const before = await findStream({...ctx, attempt: 1});

      const error = await appendLogs({
        ...ctx,
        projectId: crypto.randomUUID(),
        attempt: 1,
        offset: body.length,
        body: ndjsonBody(outputLine('more\n')),
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LeaseStreamMismatchError);
      // The wrapping transaction rolls back: updated_at and committed_length on
      // the stamped row are untouched, so a stale lease cannot tick the
      // stream's freshness or advance its CAS axis.
      const after = await findStream({...ctx, attempt: 1});
      expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
      expect(after?.committedLength).toBe(before?.committedLength);
    });

    it('isolates streams by job: a different job with the same stepId gets its own stream', async () => {
      const stepId = crypto.randomUUID();
      const jobA = crypto.randomUUID();
      const jobB = crypto.randomUUID();
      const workspaceId = crypto.randomUUID();
      const projectId = crypto.randomUUID();
      const workflowRunAttemptId = crypto.randomUUID();
      const bodyA = ndjsonBody(outputLine('a\n'));
      const bodyB = ndjsonBody(outputLine('bbbb\n'));

      const common = {
        workspaceId,
        projectId,
        workflowRunAttemptId,
        stepId,
        attempt: 1,
        offset: 0,
      };
      await appendLogs({...common, jobId: jobA, body: bodyA});
      await appendLogs({...common, jobId: jobB, body: bodyB});

      const streamA = await findStream({jobId: jobA, stepId, attempt: 1});
      const streamB = await findStream({jobId: jobB, stepId, attempt: 1});
      expect(streamA?.id).not.toBe(streamB?.id);
      expect(streamA?.committedLength).toBe(bodyA.length);
      expect(streamB?.committedLength).toBe(bodyB.length);
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

    it('counts raw ingested and normalized stored bytes on an in-order append', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('hello\n'));

      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(ingestedAdd()).toHaveBeenCalledTimes(1);
      expect(ingestedAdd()).toHaveBeenCalledWith(body.length);
      expect(storedAdd()).toHaveBeenCalledTimes(1);
      expect(storedAdd()).toHaveBeenCalledWith(body.length);
    });

    it('counts normalized stored bytes separately from raw ingested bytes', async () => {
      const ctx = newCtx();
      await allowLargeLogBudget(ctx);
      // A session line is parsed into a view row before storage, so the durable chunk is
      // byte-different from the raw body: the exact point of the raw-vs-normalized split.
      const body = ndjsonBody(sessionLine('{"type":"x"}'));

      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(ingestedAdd()).toHaveBeenCalledTimes(1);
      expect(ingestedAdd()).toHaveBeenCalledWith(body.length);
      const storedAddMock = storedAdd();
      if (!storedAddMock) throw new Error('Expected bytesStoredCount mock');
      const storedBytes = storedAddMock.mock.calls[0]?.[0];
      expect(typeof storedBytes).toBe('number');
      expect(storedBytes).not.toBe(body.length);
      const stream = await findStream({...ctx, attempt: 1});
      const chunks = await listChunks(stream?.id as string);
      expect(storedBytes).toBe(chunks[0]?.byteLen);
    });

    it('does not re-count bytes on a retried append', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('hello\n'));
      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(ingestedAdd()).toHaveBeenCalledTimes(1);
      expect(ingestedAdd()).toHaveBeenCalledWith(body.length);
      expect(storedAdd()).toHaveBeenCalledTimes(1);
    });

    it('does not count bytes for a rejected gap append', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('hello\n'));
      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      await appendLogs({
        ...ctx,
        attempt: 1,
        offset: body.length + 5,
        body: ndjsonBody(outputLine('more\n')),
      }).catch(() => undefined);

      expect(ingestedAdd()).toHaveBeenCalledTimes(1);
      expect(storedAdd()).toHaveBeenCalledTimes(1);
    });

    it('does not count bytes dropped on a closed stream', async () => {
      const ctx = newCtx();
      // End-only body so the single stored chunk stays under the 100-byte test budget.
      const end = ndjsonBody(endLine(4));
      await appendLogs({...ctx, attempt: 1, offset: 0, body: end});

      await appendLogs({
        ...ctx,
        attempt: 1,
        offset: end.length,
        body: ndjsonBody(outputLine('late\n')),
      });

      expect(ingestedAdd()).toHaveBeenCalledTimes(1);
      expect(storedAdd()).toHaveBeenCalledTimes(1);
    });

    it('counts control records in both ingested and stored byte totals', async () => {
      const ctx = newCtx();
      const body = ndjsonBody(outputLine('hello\n'), groupStartLine('g1', 'Build'), endLine(42));

      await appendLogs({...ctx, attempt: 1, offset: 0, body});

      expect(ingestedAdd()).toHaveBeenCalledTimes(1);
      expect(ingestedAdd()).toHaveBeenCalledWith(body.length);
      expect(storedAdd()).toHaveBeenCalledTimes(1);
      expect(storedAdd()).toHaveBeenCalledWith(body.length);
    });

    it('counts a cap-crossing append once and a dropped straggler as ingested only', async () => {
      const ctx = newCtx();
      // 150 payload bytes cross the 100-byte test budget, but the crossing chunk is stored in
      // full; the straggler is accepted-and-dropped, so it must not count as stored.
      const crossing = outputOfBytes(150);
      await appendLogs({...ctx, attempt: 1, offset: 0, body: crossing});
      const straggler = ndjsonBody(outputLine('late\n'));

      await appendLogs({...ctx, attempt: 1, offset: crossing.length, body: straggler});

      expect(ingestedAdd()).toHaveBeenCalledTimes(2);
      expect(ingestedAdd()).toHaveBeenCalledWith(crossing.length);
      expect(ingestedAdd()).toHaveBeenCalledWith(straggler.length);
      // The server-injected `capped` tombstone chunk never counts as stored bytes either.
      expect(storedAdd()).toHaveBeenCalledTimes(1);
      expect(storedAdd()).toHaveBeenCalledWith(crossing.length);
    });

    it('does not re-count a capped-job straggler when the runner retries it', async () => {
      const ctx = newCtx();
      const crossing = outputOfBytes(150);
      await appendLogs({...ctx, attempt: 1, offset: 0, body: crossing});
      const straggler = ndjsonBody(outputLine('late\n'));
      await appendLogs({...ctx, attempt: 1, offset: crossing.length, body: straggler});

      await appendLogs({...ctx, attempt: 1, offset: crossing.length, body: straggler});

      expect(ingestedAdd()).toHaveBeenCalledTimes(2);
      expect(storedAdd()).toHaveBeenCalledTimes(1);
    });
  });

  describe('write-path enforcement', () => {
    it.each([
      'capped',
      'runner_lost',
    ])('rejects a forged server-only %s tombstone before any row is created', async (type) => {
      const ctx = newCtx();
      const body = ndjsonBody(recordLine({type}));

      const error = await appendLogs({...ctx, attempt: 1, offset: 0, body}).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MalformedLogChunkError);
      expect(await findStream({...ctx, attempt: 1})).toBeNull();
    });

    it('rejects an invalid NDJSON record', async () => {
      const ctx = newCtx();
      const recordWithoutData = recordLine({type: 'output', stream: 'stdout'});
      const body = ndjsonBody(recordWithoutData);

      const error = await appendLogs({...ctx, attempt: 1, offset: 0, body}).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MalformedLogChunkError);
    });
  });
});
