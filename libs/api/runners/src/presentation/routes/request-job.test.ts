import {AUTH_API_KEY} from '@shipfox/api-auth-context';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {db} from '#db/db.js';
import {revokeRunnerToken} from '#db/runner-tokens.js';
import {createRunnerTokenAuthMethod} from '#presentation/auth/index.js';
import {pendingJobFactory, runnerTokenFactory} from '#test/index.js';
import {runnerRoutes} from './index.js';

const fakeApiKeyAuth: AuthMethod = {
  name: AUTH_API_KEY,
  authenticate: () => Promise.resolve(),
};

describe('POST /runners/jobs/request', () => {
  let app: FastifyInstance;
  let rawToken: string;
  let workspaceId: string;

  beforeAll(async () => {
    app = await createApp({
      auth: [fakeApiKeyAuth, createRunnerTokenAuthMethod()],
      routes: runnerRoutes,
      swagger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_pending_jobs, runners_running_jobs, runners_runner_tokens CASCADE`,
    );
    rawToken = `sf_r_${crypto.randomUUID()}`;
    workspaceId = crypto.randomUUID();
    await runnerTokenFactory.create({workspaceId}, {transient: {rawToken}});
  });

  it('returns 401 without authorization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with an invalid runner token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: 'Bearer invalid'},
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with a workspace-scoped job payload when a job is available', async () => {
    await pendingJobFactory.create({workspaceId});

    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${rawToken}`},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.job_id).toBeDefined();
    expect(body.run_id).toBeDefined();
    expect(body.job_name).toBeDefined();
    expect(Array.isArray(body.steps)).toBe(true);
  });

  it('returns 204 when no jobs are available for the token workspace', async () => {
    await pendingJobFactory.create({workspaceId: crypto.randomUUID()});

    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${rawToken}`},
    });

    expect(res.statusCode).toBe(204);
  });

  it('returns 401 when the runner token is expired', async () => {
    const expiredRawToken = `sf_r_${crypto.randomUUID()}`;
    await runnerTokenFactory.create(
      {workspaceId, expiresAt: new Date(Date.now() - 1000)},
      {transient: {rawToken: expiredRawToken}},
    );

    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${expiredRawToken}`},
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when the runner token is revoked', async () => {
    const revokedRawToken = `sf_r_${crypto.randomUUID()}`;
    const token = await runnerTokenFactory.create(
      {workspaceId},
      {transient: {rawToken: revokedRawToken}},
    );
    await revokeRunnerToken({tokenId: token.id, workspaceId});

    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${revokedRawToken}`},
    });

    expect(res.statusCode).toBe(401);
  });
});
