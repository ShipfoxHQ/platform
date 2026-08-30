import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {annotationFactory} from '#test/index.js';
import {readAnnotationSummaryRoute} from './read-annotation-summary.js';
import {readAnnotationsRoute} from './read-annotations.js';

function workspaceStatus(value: string | undefined): 'active' | 'suspended' | 'deleted' {
  if (value === 'suspended') return 'suspended';
  if (value === 'deleted') return 'deleted';
  return 'active';
}

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }

    const header = request.headers['x-test-workspaces'];
    const rawWorkspaceIds = Array.isArray(header) ? header.join(',') : (header ?? '');
    const memberships = rawWorkspaceIds
      .split(',')
      .filter((workspaceId) => workspaceId.length > 0)
      .map((value) => {
        const [workspaceId, status] = value.split('|');
        if (!workspaceId) throw new Error('missing test workspace id');
        return {workspaceId, role: 'admin' as const, workspaceStatus: workspaceStatus(status)};
      });

    setUserContext(
      request,
      buildUserContext({
        userId: 'user-1',
        email: 'user@example.com',
        memberships,
      }),
    );
    return Promise.resolve();
  },
};

describe('GET /annotations', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    app = await createApp({
      auth: [fakeUserAuth],
      routes: [
        {
          prefix: '/annotations',
          auth: AUTH_USER,
          routes: [readAnnotationSummaryRoute, readAnnotationsRoute],
        },
      ],
      swagger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await closeApp();
  });

  function readUrl(params: {
    workflowRunId: string;
    attempt: number;
    jobExecutionId?: string | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  }) {
    const search = new URLSearchParams({
      workflow_run_id: params.workflowRunId,
      attempt: String(params.attempt),
    });
    if (params.jobExecutionId) search.set('job_execution_id', params.jobExecutionId);
    if (params.cursor) search.set('cursor', params.cursor);
    if (params.limit !== undefined) search.set('limit', String(params.limit));
    return `/annotations?${search.toString()}`;
  }

  it('rejects a request without a session token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: readUrl({workflowRunId: crypto.randomUUID(), attempt: 1}),
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns annotations converted to DTOs for a visible run attempt', async () => {
    const workspaceId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const jobExecutionId = crypto.randomUUID();
    const originStepId = crypto.randomUUID();
    const annotation = await annotationFactory.create({
      workspaceId,
      workflowRunId,
      workflowRunAttempt: 2,
      jobId,
      jobExecutionId,
      originStepId,
      originStepAttempt: 3,
      context: 'deploy',
      style: 'success',
      sequence: 4,
      body: 'Deployed **v42**',
      bodyBytes: Buffer.byteLength('Deployed **v42**'),
    });

    const res = await app.inject({
      method: 'GET',
      url: readUrl({workflowRunId, attempt: 2}),
      headers: {authorization: 'Bearer user', 'x-test-workspaces': workspaceId},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      annotations: [
        {
          id: annotation.id,
          job_id: jobId,
          job_execution_id: jobExecutionId,
          origin_step_id: originStepId,
          origin_step_attempt: 3,
          context: 'deploy',
          style: 'success',
          sequence: 4,
          body: 'Deployed **v42**',
        },
      ],
      has_more: false,
      next_cursor: null,
    });
  });

  it('returns an empty list when no rows match the run attempt', async () => {
    const res = await app.inject({
      method: 'GET',
      url: readUrl({workflowRunId: crypto.randomUUID(), attempt: 1}),
      headers: {authorization: 'Bearer user', 'x-test-workspaces': crypto.randomUUID()},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({annotations: [], has_more: false, next_cursor: null});
  });

  it('returns complete style counts without loading annotation bodies', async () => {
    const workspaceId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    const firstStepId = '11111111-1111-4111-8111-111111111111';
    const secondStepId = '22222222-2222-4222-8222-222222222222';
    await annotationFactory.create({
      workspaceId,
      workflowRunId,
      originStepId: firstStepId,
      context: 'default',
      style: 'default',
    });
    await annotationFactory.create({
      workspaceId,
      workflowRunId,
      originStepId: firstStepId,
      context: 'error',
      style: 'error',
    });
    await annotationFactory.create({
      workspaceId,
      workflowRunId,
      originStepId: secondStepId,
      originStepAttempt: 2,
      context: 'warning',
      style: 'warning',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/annotations/summary?workflow_run_id=${workflowRunId}&attempt=1`,
      headers: {authorization: 'Bearer user', 'x-test-workspaces': workspaceId},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      total: 3,
      error: 1,
      warning: 1,
      info: 0,
      success: 0,
      step_counts: [
        {origin_step_id: firstStepId, origin_step_attempt: 1, total: 2},
        {origin_step_id: secondStepId, origin_step_attempt: 2, total: 1},
      ],
    });
  });

  it('returns an empty list for annotations outside the user workspaces', async () => {
    const workflowRunId = crypto.randomUUID();
    await annotationFactory.create({workflowRunId, workspaceId: crypto.randomUUID()});

    const res = await app.inject({
      method: 'GET',
      url: readUrl({workflowRunId, attempt: 1}),
      headers: {authorization: 'Bearer user', 'x-test-workspaces': crypto.randomUUID()},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({annotations: [], has_more: false, next_cursor: null});
  });

  it('does not return annotations for suspended membership claims', async () => {
    const workspaceId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    await annotationFactory.create({workspaceId, workflowRunId});

    const res = await app.inject({
      method: 'GET',
      url: readUrl({workflowRunId, attempt: 1}),
      headers: {
        authorization: 'Bearer user',
        'x-test-workspaces': `${workspaceId}|suspended`,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({annotations: [], has_more: false, next_cursor: null});
  });

  it('returns an empty list when the job execution filter has no matches', async () => {
    const workspaceId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    await annotationFactory.create({workspaceId, workflowRunId});

    const res = await app.inject({
      method: 'GET',
      url: readUrl({
        workflowRunId,
        attempt: 1,
        jobExecutionId: crypto.randomUUID(),
      }),
      headers: {authorization: 'Bearer user', 'x-test-workspaces': workspaceId},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({annotations: [], has_more: false, next_cursor: null});
  });

  it('limits the returned annotations and returns a continuation cursor', async () => {
    const workspaceId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    const first = await annotationFactory.create({
      workspaceId,
      workflowRunId,
      jobExecutionId: crypto.randomUUID(),
      context: 'first',
      sequence: 1,
    });
    const second = await annotationFactory.create({
      workspaceId,
      workflowRunId,
      jobExecutionId: crypto.randomUUID(),
      context: 'second',
      sequence: 2,
    });

    const firstPage = await app.inject({
      method: 'GET',
      url: readUrl({workflowRunId, attempt: 1, limit: 1}),
      headers: {authorization: 'Bearer user', 'x-test-workspaces': workspaceId},
    });
    expect(firstPage.statusCode).toBe(200);
    const firstBody = firstPage.json();
    expect(firstBody).toMatchObject({
      annotations: [
        {
          id: first.id,
          context: 'first',
          sequence: 1,
        },
      ],
      has_more: true,
    });
    expect(typeof firstBody.next_cursor).toBe('string');

    const secondPage = await app.inject({
      method: 'GET',
      url: readUrl({
        workflowRunId,
        attempt: 1,
        cursor: firstBody.next_cursor,
        limit: 1,
      }),
      headers: {authorization: 'Bearer user', 'x-test-workspaces': workspaceId},
    });

    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json()).toMatchObject({
      annotations: [
        {
          id: second.id,
          context: 'second',
          sequence: 2,
        },
      ],
      has_more: false,
      next_cursor: null,
    });
  });

  it('rejects malformed query values', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/annotations?workflow_run_id=not-a-uuid&attempt=0',
      headers: {authorization: 'Bearer user', 'x-test-workspaces': crypto.randomUUID()},
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects attempts outside the database integer range', async () => {
    const res = await app.inject({
      method: 'GET',
      url: readUrl({workflowRunId: crypto.randomUUID(), attempt: 2_147_483_648}),
      headers: {authorization: 'Bearer user', 'x-test-workspaces': crypto.randomUUID()},
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects limits above the server response cap', async () => {
    const res = await app.inject({
      method: 'GET',
      url: readUrl({workflowRunId: crypto.randomUUID(), attempt: 1, limit: 501}),
      headers: {authorization: 'Bearer user', 'x-test-workspaces': crypto.randomUUID()},
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed continuation cursors', async () => {
    const res = await app.inject({
      method: 'GET',
      url: readUrl({workflowRunId: crypto.randomUUID(), attempt: 1, cursor: 'not-a-cursor'}),
      headers: {authorization: 'Bearer user', 'x-test-workspaces': crypto.randomUUID()},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid-cursor');
  });

  it('rejects empty continuation cursors', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${readUrl({workflowRunId: crypto.randomUUID(), attempt: 1})}&cursor=`,
      headers: {authorization: 'Bearer user', 'x-test-workspaces': crypto.randomUUID()},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid-cursor');
  });
});
