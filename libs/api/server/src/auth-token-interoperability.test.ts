import {createLeaseTokenAuthMethod, issueJobLeaseToken} from '@shipfox/api-auth';
import {AUTH_LEASED_JOB, requireLeasedJobContext} from '@shipfox/api-auth-context';
import {closeApp, createApp, defineRoute} from '@shipfox/node-fastify';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';

vi.hoisted(() => {
  process.env.AUTH_ROOT_KEY ??= 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
  process.env.API_PUBLIC_URL ??= 'https://api.example.test';
});

const leaseRoute = defineRoute({
  method: 'GET',
  path: '/lease',
  description: 'Auth composition test route.',
  handler: (request) => {
    const lease = requireLeasedJobContext(request);
    return {job_id: lease.jobId, step_id: lease.currentStepId};
  },
});

describe('Auth token interoperability', () => {
  afterEach(async () => {
    await closeApp();
  });

  it('accepts an Auth-issued step lease through the server route boundary', async () => {
    const jobId = crypto.randomUUID();
    const stepId = crypto.randomUUID();
    const token = await issueJobLeaseToken({
      jobId,
      jobExecutionId: crypto.randomUUID(),
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      runnerSessionId: crypto.randomUUID(),
      currentStepId: stepId,
      currentStepAttempt: 1,
    });
    const app = await createApp({
      auth: [createLeaseTokenAuthMethod()],
      routes: [{prefix: '/runs/jobs/current', auth: AUTH_LEASED_JOB, routes: [leaseRoute]}],
      swagger: false,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/runs/jobs/current/lease',
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({job_id: jobId, step_id: stepId});
  }, 15_000);
});
