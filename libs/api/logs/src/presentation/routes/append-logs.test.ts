import {Buffer} from 'node:buffer';
import {AUTH_USER} from '@shipfox/api-auth-context';
import {type AuthMethod, closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {appendServerRecords} from '#core/append-server-records.js';
import {fakeLeaseTokenAuthMethod, mintLeaseToken} from '#test/fixtures/lease-token.js';
import {endLine, ndjsonBody, outputLine, recordLine} from '#test/fixtures/ndjson.js';
import {createTestWorkflowsClient} from '#test/fixtures/workflows-client.js';
import {createLogsRoutes} from './index.js';

const NDJSON = 'application/x-ndjson';
const JOB_EXECUTION_ID = '00000000-0000-4000-8000-0000000000ee';

// logsRoutes also carries the session-authed read group; register a no-op AUTH_USER method
// so auth-reference validation passes (these tests only exercise the lease append route).
const stubUserAuth: AuthMethod = {name: AUTH_USER, authenticate: () => Promise.resolve()};

function logsUrl(stepId: string, attempt: number, offset: number): string {
  return `/runs/jobs/current/steps/${stepId}/logs?attempt=${attempt}&offset=${offset}`;
}

function mintTestLeaseToken(params: {
  jobId?: string;
  stepId: string;
  attempt?: number;
  workspaceId?: string;
  projectId?: string;
  workflowRunAttemptId?: string;
}): Promise<string> {
  return mintLeaseToken({
    jobId: params.jobId ?? crypto.randomUUID(),
    jobExecutionId: JOB_EXECUTION_ID,
    ...(params.workspaceId ? {workspaceId: params.workspaceId} : {}),
    ...(params.projectId ? {projectId: params.projectId} : {}),
    ...(params.workflowRunAttemptId ? {workflowRunAttemptId: params.workflowRunAttemptId} : {}),
    currentStepId: params.stepId,
    currentStepAttempt: params.attempt ?? 1,
  });
}

describe('POST /runs/jobs/current/steps/:stepId/logs', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({
      auth: [fakeLeaseTokenAuthMethod, stubUserAuth],
      routes: createLogsRoutes(createTestWorkflowsClient()),
      swagger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('rejects a request without a lease token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: logsUrl(crypto.randomUUID(), 1, 0),
      headers: {'content-type': NDJSON},
      payload: ndjsonBody(outputLine('hi\n')),
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
  });

  it('accepts an in-order append and returns the committed length', async () => {
    const jobId = crypto.randomUUID();
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken({jobId, stepId});
    const body = ndjsonBody(outputLine('installing\n'));

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({committed_length: body.length, capped: false});
  });

  it('rejects appends for a step outside the leased execution', async () => {
    const leasedStepId = crypto.randomUUID();
    const requestedStepId = crypto.randomUUID();
    const token = await mintTestLeaseToken({stepId: leasedStepId});

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(requestedStepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: ndjsonBody(outputLine('wrong execution\n')),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('step-not-found');
  });

  it('rejects appends for a different attempt than the leased step scope', async () => {
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken({stepId, attempt: 1});

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 2, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: ndjsonBody(outputLine('wrong attempt\n')),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('step-not-found');
  });

  it('rejects appends with a job-scoped lease token', async () => {
    const stepId = crypto.randomUUID();
    const token = await mintLeaseToken({
      jobId: crypto.randomUUID(),
      jobExecutionId: JOB_EXECUTION_ID,
    });

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: ndjsonBody(outputLine('job scoped\n')),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('step-not-found');
  });

  it('acks a re-sent append at an earlier offset', async () => {
    const jobId = crypto.randomUUID();
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken({jobId, stepId});
    const body = ndjsonBody(outputLine('once\n'));
    await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: body,
    });

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({committed_length: body.length, capped: false});
  });

  it('rejects an offset gap with 409 and the committed length', async () => {
    const jobId = crypto.randomUUID();
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken({jobId, stepId});
    const body = ndjsonBody(outputLine('first\n'));
    await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: body,
    });

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, body.length + 10),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: ndjsonBody(outputLine('gap\n')),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('offset-gap');
    expect(res.json().details).toEqual({committed_length: body.length});
  });

  it('stops a lease append when a server writer owns the stream', async () => {
    const jobId = crypto.randomUUID();
    const stepId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const workflowRunAttemptId = crypto.randomUUID();
    const token = await mintTestLeaseToken({
      jobId,
      stepId,
      workspaceId,
      projectId,
      workflowRunAttemptId,
    });
    await appendServerRecords({
      jobId,
      stepId,
      workspaceId,
      projectId,
      workflowRunAttemptId,
      attempt: 1,
      records: [{v: 1, ts: 1, type: 'output', stream: 'stdout', data: 'server\n'}],
    });

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: ndjsonBody(outputLine('runner\n')),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({code: 'log-writer-conflict'});
  });

  it('rejects a forged server-only tombstone with 400', async () => {
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken({stepId});

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: ndjsonBody(recordLine({type: 'capped'})),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('malformed-log-chunk');
  });

  it('rejects a body that is not newline-terminated with 400', async () => {
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken({stepId});

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: '{"v":1,"ts":1,"type":"output","stream":"stdout","data":"no newline"}',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('malformed-log-chunk');
  });

  it('rejects a record whose data exceeds the per-record byte cap with 400', async () => {
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken({stepId});

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: ndjsonBody(outputLine('x'.repeat(16 * 1024 + 1))),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('malformed-log-chunk');
  });

  it('treats an empty body as a no-op', async () => {
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken({stepId});

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: '',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({committed_length: 0, capped: false});
  });

  it('rejects a non-ndjson content type with 415', async () => {
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken({stepId});

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
      payload: '{"hello":"world"}',
    });

    expect(res.statusCode).toBe(415);
  });

  it('rejects a body over the configured size limit with 413', async () => {
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken({stepId});
    // Test body limit is 64 KiB (LOG_APPEND_BODY_LIMIT_BYTES in test/env.ts).
    const oversize = Buffer.alloc(65536 + 1024, 0x61).toString('utf8');

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: oversize,
    });

    expect(res.statusCode).toBe(413);
  });

  it('reports capped once the budget is crossed', async () => {
    const jobId = crypto.randomUUID();
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken({jobId, stepId});

    const res = await app.inject({
      method: 'POST',
      url: logsUrl(stepId, 1, 0),
      headers: {authorization: `Bearer ${token}`, 'content-type': NDJSON},
      payload: ndjsonBody(outputLine('x'.repeat(150)), endLine(150)),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().capped).toBe(true);
  });
});
