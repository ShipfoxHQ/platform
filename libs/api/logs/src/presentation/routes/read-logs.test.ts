import {Buffer} from 'node:buffer';
import {gunzipSync} from 'node:zlib';
import {
  AUTH_LEASED_JOB,
  AUTH_USER,
  buildUserContext,
  setUserContext,
} from '@shipfox/api-auth-context';
import {parseLogRecordLine} from '@shipfox/api-logs-dto';
import type {
  LogOutcomeDto,
  WorkflowsStepAttemptTerminatedEventDto,
} from '@shipfox/api-workflows-dto';
import {
  type AuthMethod,
  ClientError,
  closeApp,
  createApp,
  type FastifyInstance,
} from '@shipfox/node-fastify';
import {MockActivityEnvironment} from '@temporalio/testing';
import {eq, sql} from 'drizzle-orm';
import type {FastifyRequest} from 'fastify';
import {deleteObject, getObjectBytes as readObjectBytes} from '#api/object-storage.js';
import {config} from '#config.js';
import type {AttemptStream} from '#core/entities/attempt-stream.js';
import {buildLogReadResult} from '#core/read-logs.js';
import {insertChunk} from '#db/chunks.js';
import {db} from '#db/db.js';
import {attemptStreams} from '#db/schema/attempt-streams.js';
import {getOrCreateAttemptStream} from '#db/streams.js';
import {
  type CompactStreamResult,
  compactStreamActivity,
} from '#temporal/activities/compact-stream.js';
import {ndjsonBody, outputLine, recordLine} from '#test/fixtures/ndjson.js';
import {createTestWorkflowsClient} from '#test/fixtures/workflows-client.js';
import {findStream} from '#test/queries.js';
import {onStepAttemptTerminated} from '../subscribers/on-step-attempt-terminated.js';
import {createLogsRoutes} from './index.js';

// AUTH_USER stub: a `Bearer user` request is a member of whatever workspace it names in the
// `x-test-workspace` header, so each test grants or withholds access against the arranged
// stream's workspace. The lease method is stubbed only so the append group's auth resolves.
const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }
    const header = request.headers['x-test-workspace'];
    const value = Array.isArray(header) ? header[0] : header;
    const [workspaceId, status] = value?.split('|') ?? [];
    const workspaceStatus = status === 'suspended' || status === 'deleted' ? status : 'active';
    setUserContext(
      request,
      buildUserContext({
        userId: 'user-1',
        email: 'user@example.com',
        memberships: workspaceId ? [{workspaceId, role: 'admin', workspaceStatus}] : [],
      }),
    );
    return Promise.resolve();
  },
};
const stubLeaseAuth: AuthMethod = {name: AUTH_LEASED_JOB, authenticate: () => Promise.resolve()};

interface ChunkSpec {
  data: Buffer;
  origin?: 'runner' | 'control';
}

async function arrangeStream(opts: {
  workspaceId: string;
  chunks: (Buffer | ChunkSpec)[];
  state?: 'open' | 'closed';
  truncated?: boolean;
}): Promise<AttemptStream> {
  const identity = {
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    attempt: 1,
    workspaceId: opts.workspaceId,
    projectId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
  };
  await db().transaction(async (tx) => {
    const stream = await getOrCreateAttemptStream(tx, identity);
    let offset = 0;
    for (const chunk of opts.chunks) {
      const spec = Buffer.isBuffer(chunk) ? {data: chunk, origin: 'runner' as const} : chunk;
      const origin = spec.origin ?? 'runner';
      await insertChunk(tx, {
        streamId: stream.id,
        streamOffset: offset,
        byteLen: spec.data.length,
        data: spec.data,
        origin,
      });
      // Control chunks do not advance the runner byte axis (committed_length).
      if (origin === 'runner') offset += spec.data.length;
    }
    await tx
      .update(attemptStreams)
      .set({
        committedLength: offset,
        state: opts.state ?? 'open',
        ...(opts.state === 'closed' ? {closeReason: 'declared', closedAt: sql`now()`} : {}),
        truncated: opts.truncated ?? false,
      })
      .where(eq(attemptStreams.id, stream.id));
  });
  const stream = await findStream(identity);
  if (!stream) throw new Error('arranged stream missing');
  return stream;
}

function terminatedEvent(opts: {
  workspaceId: string;
  logOutcome: LogOutcomeDto;
}): WorkflowsStepAttemptTerminatedEventDto {
  return {
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    attempt: 1,
    workspaceId: opts.workspaceId,
    projectId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    logOutcome: opts.logOutcome,
  };
}

async function consumeTerminatedEvent(
  payload: WorkflowsStepAttemptTerminatedEventDto,
): Promise<void> {
  await onStepAttemptTerminated(payload);
}

async function getObjectBytes(key: string): Promise<Buffer> {
  const body = await readObjectBytes(key);
  if (!body) throw new Error('object has no body');
  return body;
}

function runCompaction(streamId: string): Promise<CompactStreamResult> {
  return new MockActivityEnvironment().run(compactStreamActivity, {streamId});
}

async function compact(streamId: string): Promise<string> {
  const result = await runCompaction(streamId);
  if (result.outcome !== 'compacted') throw new Error(`expected compacted, got ${result.outcome}`);
  return result.objectKey;
}

describe('GET /steps/:stepId/attempts/:attempt/logs', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({
      auth: [fakeUserAuth, stubLeaseAuth],
      routes: createLogsRoutes(createTestWorkflowsClient()),
      swagger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await closeApp();
  });

  function readUrl(stepId: string, attempt: number, cursor: number): string {
    return `/steps/${stepId}/attempts/${attempt}/logs?cursor=${cursor}`;
  }

  function authedGet(stream: AttemptStream, cursor: number, workspaceClaim = stream.workspaceId) {
    return app.inject({
      method: 'GET',
      url: readUrl(stream.stepId, stream.attempt, cursor),
      headers: {authorization: 'Bearer user', 'x-test-workspace': workspaceClaim},
    });
  }

  it('rejects a request without a session token', async () => {
    const res = await app.inject({method: 'GET', url: readUrl(crypto.randomUUID(), 1, 0)});

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
  });

  it('returns 404 for a step that has no stream', async () => {
    const res = await app.inject({
      method: 'GET',
      url: readUrl(crypto.randomUUID(), 1, 0),
      headers: {authorization: 'Bearer user', 'x-test-workspace': crypto.randomUUID()},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  it('returns 404 before the terminated event, then returns a closed empty drained stream', async () => {
    const terminal = terminatedEvent({
      workspaceId: crypto.randomUUID(),
      logOutcome: 'drained',
    });

    const beforeEvent = await app.inject({
      method: 'GET',
      url: readUrl(terminal.stepId, terminal.attempt, 0),
      headers: {authorization: 'Bearer user', 'x-test-workspace': terminal.workspaceId},
    });
    await consumeTerminatedEvent(terminal);
    const afterEvent = await app.inject({
      method: 'GET',
      url: readUrl(terminal.stepId, terminal.attempt, 0),
      headers: {authorization: 'Bearer user', 'x-test-workspace': terminal.workspaceId},
    });

    expect(beforeEvent.statusCode).toBe(404);
    expect(beforeEvent.json().code).toBe('not-found');
    expect(afterEvent.statusCode).toBe(200);
    const body = afterEvent.json();
    expect(body.mode).toBe('inline');
    expect(body.state).toBe('closed');
    expect(body.truncated).toBe(false);
    expect(body.ndjson).toBe('');
    const stream = await findStream(terminal);
    expect(stream?.state).toBe('closed');
    expect(stream?.closeReason).toBe('declared');
  });

  it('returns 404 before the terminated event, then returns a runner_lost abandoned stream', async () => {
    const terminal = terminatedEvent({
      workspaceId: crypto.randomUUID(),
      logOutcome: 'abandoned',
    });

    const beforeEvent = await app.inject({
      method: 'GET',
      url: readUrl(terminal.stepId, terminal.attempt, 0),
      headers: {authorization: 'Bearer user', 'x-test-workspace': terminal.workspaceId},
    });
    await consumeTerminatedEvent(terminal);
    const afterEvent = await app.inject({
      method: 'GET',
      url: readUrl(terminal.stepId, terminal.attempt, 0),
      headers: {authorization: 'Bearer user', 'x-test-workspace': terminal.workspaceId},
    });

    expect(beforeEvent.statusCode).toBe(404);
    expect(beforeEvent.json().code).toBe('not-found');
    expect(afterEvent.statusCode).toBe(200);
    const body = afterEvent.json();
    expect(body.mode).toBe('inline');
    expect(body.state).toBe('closed');
    expect(body.truncated).toBe(true);
    const records = body.ndjson.split('\n').filter(Boolean).map(parseLogRecordLine);
    expect(records).toMatchObject([{type: 'runner_lost'}]);
    const stream = await findStream(terminal);
    expect(stream?.state).toBe('closed');
    expect(stream?.closeReason).toBe('timeout');
  });

  it('keeps returning 404 for a running missing attempt', async () => {
    const running = {stepId: crypto.randomUUID(), attempt: 1, workspaceId: crypto.randomUUID()};

    const res = await app.inject({
      method: 'GET',
      url: readUrl(running.stepId, running.attempt, 0),
      headers: {authorization: 'Bearer user', 'x-test-workspace': running.workspaceId},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  it('returns 404 (no existence leak) when the caller is not a member of the workspace', async () => {
    const stream = await arrangeStream({
      workspaceId: crypto.randomUUID(),
      chunks: [ndjsonBody(outputLine('secret\n'))],
    });

    const res = await authedGet(stream, 0, crypto.randomUUID());

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  it('returns workspace-suspended for a suspended membership claim', async () => {
    const stream = await arrangeStream({
      workspaceId: crypto.randomUUID(),
      chunks: [ndjsonBody(outputLine('secret\n'))],
    });

    const res = await authedGet(stream, 0, `${stream.workspaceId}|suspended`);

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('workspace-suspended');
  });

  it('serves an open stream inline with the next cursor and stream state', async () => {
    const workspaceId = crypto.randomUUID();
    const lineA = outputLine('alpha\n');
    const lineB = outputLine('beta\n');
    const stream = await arrangeStream({
      workspaceId,
      chunks: [ndjsonBody(lineA), ndjsonBody(lineB)],
    });

    const res = await authedGet(stream, 0);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('inline');
    expect(body.state).toBe('open');
    expect(body.truncated).toBe(false);
    expect(body.has_more).toBe(false);
    expect(body.ndjson).toBe(lineA + lineB);
    const records = body.ndjson.split('\n').filter(Boolean).map(parseLogRecordLine);
    expect(records).toEqual([
      {v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'alpha\n'},
      {v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'beta\n'},
    ]);

    const reread = await authedGet(stream, body.next_cursor);
    expect(reread.json().ndjson).toBe('');
    expect(reread.json().has_more).toBe(false);
    expect(reread.json().next_cursor).toBe(body.next_cursor);
  });

  it('interleaves server control records with runner bytes in seq order', async () => {
    const workspaceId = crypto.randomUUID();
    const stream = await arrangeStream({
      workspaceId,
      state: 'closed',
      chunks: [
        {data: ndjsonBody(outputLine('a\n'))},
        {data: ndjsonBody(recordLine({type: 'capped'})), origin: 'control'},
        {data: ndjsonBody(outputLine('b\n'))},
      ],
    });

    const res = await authedGet(stream, 0);

    const records = res.json().ndjson.split('\n').filter(Boolean).map(parseLogRecordLine);
    expect(records.map((record: {type: string}) => record.type)).toEqual([
      'output',
      'capped',
      'output',
    ]);
  });

  it('returns inline bytes byte-identical to the compacted object', async () => {
    const workspaceId = crypto.randomUUID();
    const stream = await arrangeStream({
      workspaceId,
      state: 'closed',
      chunks: [ndjsonBody(outputLine('one\n')), ndjsonBody(outputLine('two\n'))],
    });

    const inline = await authedGet(stream, 0);
    expect(inline.json().mode).toBe('inline');
    const inlineNdjson = inline.json().ndjson;

    const objectKey = await compact(stream.id);
    const objectBytes = gunzipSync(await getObjectBytes(objectKey)).toString('utf8');
    expect(objectBytes).toBe(inlineNdjson);

    await deleteObject(objectKey);
  });

  it('pages a stream larger than the inline cap and drains via has_more', async () => {
    const workspaceId = crypto.randomUUID();
    // Test cap is 256 bytes (LOG_READ_INLINE_MAX_BYTES); these six lines exceed it.
    const lines = Array.from({length: 6}, (_, i) => outputLine(`line-${i}\n`));
    const stream = await arrangeStream({
      workspaceId,
      chunks: lines.map((line) => ndjsonBody(line)),
    });

    let cursor = 0;
    let collected = '';
    let pages = 0;
    let hasMore = true;
    while (hasMore && pages < 20) {
      const body = (await authedGet(stream, cursor)).json();
      collected += body.ndjson;
      cursor = body.next_cursor;
      hasMore = body.has_more;
      pages += 1;
    }

    expect(pages).toBeGreaterThan(1);
    expect(hasMore).toBe(false);
    expect(collected).toBe(lines.join(''));
  });

  it('serves a closed-but-uncompacted stream inline and surfaces truncation', async () => {
    const workspaceId = crypto.randomUUID();
    const stream = await arrangeStream({
      workspaceId,
      state: 'closed',
      truncated: true,
      chunks: [ndjsonBody(outputLine('x\n'))],
    });

    const body = (await authedGet(stream, 0)).json();

    expect(body.mode).toBe('inline');
    expect(body.state).toBe('closed');
    expect(body.truncated).toBe(true);
  });

  it('serves a compacted stream as a working presigned URL', async () => {
    const workspaceId = crypto.randomUUID();
    const ndjson = outputLine('hello\n');
    const stream = await arrangeStream({
      workspaceId,
      state: 'closed',
      chunks: [ndjsonBody(ndjson)],
    });
    const objectKey = await compact(stream.id);

    const body = (await authedGet(stream, 0)).json();

    expect(body.mode).toBe('presigned');
    expect(body.state).toBe('closed');
    expect(typeof body.url).toBe('string');
    expect(body.total_bytes).toBe(stream.committedLength);
    const ttlMs = config.LOG_READ_URL_TTL_SECONDS * 1000;
    expect(Math.abs(Date.parse(body.expires_at) - (Date.now() + ttlMs))).toBeLessThan(60_000);

    const fetched = await fetch(body.url);
    expect(fetched.status).toBe(200);
    const raw = Buffer.from(await fetched.arrayBuffer());
    // undici may auto-decompress the gzip object (Content-Encoding: gzip), so accept either.
    const content =
      raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
    expect(content).toBe(ndjson);

    await deleteObject(objectKey);
  });

  it('serves stream metadata on the logs endpoint for an existing stream', async () => {
    const stream = await arrangeStream({
      workspaceId: crypto.randomUUID(),
      chunks: [],
    });

    const res = await authedGet(stream, 0);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      mode: 'inline',
      state: 'open',
      truncated: false,
    });
  });

  it('serves normalized session records as log NDJSON with terminal stream state', async () => {
    const row = {
      kind: 'message',
      timestamp: 1,
      role: 'assistant',
      label: 'assistant',
      meta: [],
      text: 'Done.',
      terminalFailure: false,
    } as const;
    const stream = await arrangeStream({
      workspaceId: crypto.randomUUID(),
      state: 'closed',
      truncated: true,
      chunks: [ndjsonBody(recordLine({type: 'agent_session', row}))],
    });

    const res = await authedGet(stream, 0);
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      mode: 'inline',
      state: 'closed',
      truncated: true,
    });
    expect(parseLogRecordLine(body.ndjson.trim())).toEqual({
      v: 1,
      ts: 1,
      type: 'agent_session',
      row,
    });
  });
});

describe('buildLogReadResult compaction boundary', () => {
  // The route always reloads the row, so the race the guard defends against (a closed stream
  // that compacts between the load and the chunk read) can't be staged through HTTP. Exercise
  // the guard directly: hand it a stale pre-compaction snapshot while the row has since compacted.
  it('re-reads and serves presigned when a closed stream compacts after it was loaded', async () => {
    const stale = await arrangeStream({
      workspaceId: crypto.randomUUID(),
      state: 'closed',
      chunks: [],
    });

    await db()
      .update(attemptStreams)
      .set({objectKey: 'logs/compacted-after-load.ndjson.gz'})
      .where(eq(attemptStreams.id, stale.id));

    const result = await buildLogReadResult(stale, 0);

    expect(result.mode).toBe('presigned');
  });
});
