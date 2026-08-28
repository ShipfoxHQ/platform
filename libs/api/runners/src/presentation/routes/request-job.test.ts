import {AUTH_PROVISIONER_TOKEN, AUTH_USER} from '@shipfox/api-auth-context';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {config} from '#config.js';
import {db} from '#db/db.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
import {createRunnerRegistrationTokenAuthMethod} from '#presentation/auth/index.js';
import {
  fakeLeaseTokenAuthMethod,
  fakeRunnerSessionAuthMethod,
  getLeaseTokenClaims,
  manualRegistrationTokenFactory,
  pendingJobFactory,
  runnersTestAuthClient,
} from '#test/index.js';
import {createRunnerRoutes} from './index.js';

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: () => Promise.resolve(),
};

const fakeProvisionerAuth: AuthMethod = {
  name: AUTH_PROVISIONER_TOKEN,
  authenticate: () => Promise.resolve(),
};

describe('POST /runners/jobs/request', () => {
  let app: FastifyInstance;
  let rawToken: string;
  let workspaceId: string;
  let sessionToken: string;
  let runnerSessionId: string;

  beforeAll(async () => {
    app = await createApp({
      auth: [
        fakeUserAuth,
        createRunnerRegistrationTokenAuthMethod(),
        fakeRunnerSessionAuthMethod,
        fakeLeaseTokenAuthMethod,
        fakeProvisionerAuth,
      ],
      routes: createRunnerRoutes(runnersTestAuthClient),
      swagger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    rawToken = `sf_mrt_${crypto.randomUUID()}`;
    workspaceId = crypto.randomUUID();
    await manualRegistrationTokenFactory.create({workspaceId}, {transient: {rawToken}});
    const registered = await registerSession(rawToken);
    sessionToken = registered.sessionToken;
    runnerSessionId = registered.runnerSessionId;
  });

  async function registerSession(
    token: string,
    lifecycleCapabilities?: string[],
  ): Promise<{sessionToken: string; runnerSessionId: string}> {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${token}`},
      payload: {
        labels: ['Linux', 'x64'],
        ...(lifecycleCapabilities ? {lifecycle_capabilities: lifecycleCapabilities} : {}),
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    return {sessionToken: body.session_token, runnerSessionId: body.session_id};
  }

  it('returns 401 without authorization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with an invalid runner session token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: 'Bearer invalid'},
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with the job ids and a verifiable lease token when a job is available', async () => {
    const created = await pendingJobFactory.create({workspaceId});

    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${sessionToken}`},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.job_id).toBe(created.jobId);
    expect(body.workflow_run_id).toBe(created.workflowRunId);
    expect(body.workflow_run_attempt_id).toBe(created.workflowRunAttemptId);
    expect(typeof body.lease_token).toBe('string');
    expect(body.job_name).toBeUndefined();
    expect(body.steps).toBeUndefined();
    expect(body.isolation_timeout_seconds).toBeUndefined();

    const claims = getLeaseTokenClaims(body.lease_token);
    expect(claims).toMatchObject({
      jobId: created.jobId,
      workflowRunId: created.workflowRunId,
      workflowRunAttemptId: created.workflowRunAttemptId,
      projectId: created.projectId,
      workspaceId,
      runnerSessionId,
    });
  });

  it('returns the negotiated isolation timeout to a capable runner', async () => {
    const capable = await registerSession(rawToken, ['local_execution_fence_v1']);
    const created = await pendingJobFactory.create({workspaceId});

    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${capable.sessionToken}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().isolation_timeout_seconds).toBe(
      config.RUNNER_LOCAL_ISOLATION_TIMEOUT_SECONDS,
    );
    const [session] = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.id, capable.runnerSessionId));
    expect(session?.lifecycleCapabilities).toEqual(['local_execution_fence_v1']);
    expect(res.json().job_id).toBe(created.jobId);
  });

  it('returns 204 when no jobs are available for the session workspace', async () => {
    await pendingJobFactory.create({workspaceId: crypto.randomUUID()});

    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${sessionToken}`},
    });

    expect(res.statusCode).toBe(204);
  });

  it('returns 204 when no pending job matches the session labels', async () => {
    await pendingJobFactory.create({workspaceId, requiredLabels: ['macos']});

    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${sessionToken}`},
    });

    expect(res.statusCode).toBe(204);
  });

  it('claims multiple jobs from one manual session', async () => {
    const first = await pendingJobFactory.create({workspaceId});
    const second = await pendingJobFactory.create({workspaceId});

    const firstRes = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${sessionToken}`},
    });
    const secondRes = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${sessionToken}`},
    });

    expect(firstRes.statusCode).toBe(200);
    expect(firstRes.json().job_id).toBe(first.jobId);
    expect(secondRes.statusCode).toBe(200);
    expect(secondRes.json().job_id).toBe(second.jobId);
  });

  it('returns 401 when the runner session token is expired', async () => {
    const expiredSessionToken = 'invalid';

    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${expiredSessionToken}`},
    });

    expect(res.statusCode).toBe(401);
  });
});
