import {AUTH_PROVISIONER_TOKEN, AUTH_USER} from '@shipfox/api-auth-context';
import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {claimJobExecution} from '#core/job-executions.js';
import {db} from '#db/db.js';
import {reconcileTerminalJobExecution} from '#db/job-executions.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
import {runningJobExecutions} from '#db/schema/running-job-executions.js';
import {createRunnerRegistrationTokenAuthMethod} from '#presentation/auth/index.js';
import {
  fakeLeaseTokenAuthMethod,
  fakeRunnerSessionAuthMethod,
  getLeaseTokenClaims,
  mintLeaseToken,
  pendingJobFactory,
  runnerSessionFactory,
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

const fullCapabilities: RunnerToolCapabilitiesDto = {
  harnesses: {
    pi: {tools: ['read', 'bash', 'web_search']},
    claude: {tools: ['Read', 'Bash', 'WebSearch']},
  },
};

const partialCapabilities: RunnerToolCapabilitiesDto = {
  harnesses: {
    pi: {tools: ['read']},
  },
};

describe('POST /runners/jobs/:jobId/heartbeat', () => {
  let app: FastifyInstance;
  let workspaceId: string;
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
    workspaceId = crypto.randomUUID();
    const session = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = session.id;
  });

  async function claimAvailableJob(): Promise<{
    jobId: string;
    jobExecutionId: string;
    workflowRunId: string;
    workflowRunAttemptId: string;
    leaseToken: string;
  }> {
    const pending = await pendingJobFactory.create({workspaceId});
    const claimed = await claimJobExecution({
      auth: runnersTestAuthClient,
      workspaceId,
      runnerSessionId,
      sessionLabels: ['linux', 'x64'],
      maxClaims: null,
    });
    expect(claimed).not.toBeNull();
    return {
      jobId: pending.jobId,
      jobExecutionId: claimed?.jobExecutionId as string,
      workflowRunId: pending.workflowRunId,
      workflowRunAttemptId: pending.workflowRunAttemptId,
      leaseToken: claimed?.leaseToken as string,
    };
  }

  it('returns 401 without authorization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${crypto.randomUUID()}/heartbeat`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 200 + cancel:false on a fresh row', async () => {
    const {jobId, jobExecutionId, workflowRunId, workflowRunAttemptId, leaseToken} =
      await claimAvailableJob();

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${jobId}/heartbeat`,
      headers: {authorization: `Bearer ${leaseToken}`},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{cancel: boolean; lease_token: string}>();
    expect(body).toEqual({cancel: false, lease_token: expect.any(String)});
    const refreshedLease = getLeaseTokenClaims(body.lease_token);
    expect(refreshedLease).toMatchObject({
      jobId,
      jobExecutionId,
      workflowRunId,
      workflowRunAttemptId,
      runnerSessionId,
    });
    expect(refreshedLease?.currentStepId).toBeUndefined();
    expect(refreshedLease?.currentStepAttempt).toBeUndefined();
    const [running] = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobExecutionId, jobExecutionId));
    expect(running?.firstHeartbeatAt).toBeInstanceOf(Date);
  });

  it('refreshes job heartbeat and runner capability report', async () => {
    const {jobId, jobExecutionId, leaseToken} = await claimAvailableJob();

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${jobId}/heartbeat`,
      headers: {authorization: `Bearer ${leaseToken}`},
      payload: {capabilities: fullCapabilities},
    });

    expect(res.statusCode).toBe(200);
    const [running] = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobExecutionId, jobExecutionId));
    const [session] = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.id, runnerSessionId));
    expect(running?.firstHeartbeatAt).toBeInstanceOf(Date);
    expect(session?.toolCapabilities).toEqual(fullCapabilities);
    expect(session?.toolCapabilitiesReportedAt).toBeInstanceOf(Date);
  });

  it('clears the stored capability report when heartbeat omits capabilities', async () => {
    const {jobId, leaseToken} = await claimAvailableJob();
    await db()
      .update(runnerSessions)
      .set({
        toolCapabilities: partialCapabilities,
        toolCapabilitiesReportedAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      .where(eq(runnerSessions.id, runnerSessionId));

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${jobId}/heartbeat`,
      headers: {authorization: `Bearer ${leaseToken}`},
    });

    expect(res.statusCode).toBe(200);
    const [session] = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.id, runnerSessionId));
    expect(session?.toolCapabilities).toBeNull();
    expect(session?.toolCapabilitiesReportedAt).toBeNull();
  });

  it('rejects malformed capability reports without liveness or capability side effects', async () => {
    const {jobId, jobExecutionId, leaseToken} = await claimAvailableJob();
    await db()
      .update(runnerSessions)
      .set({
        toolCapabilities: partialCapabilities,
        toolCapabilitiesReportedAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      .where(eq(runnerSessions.id, runnerSessionId));
    const [beforeRunning] = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobExecutionId, jobExecutionId));

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${jobId}/heartbeat`,
      headers: {authorization: `Bearer ${leaseToken}`},
      payload: {capabilities: {harnesses: {pi: {tools: ['read', 'read']}}}},
    });

    expect(res.statusCode).toBe(400);
    const [afterRunning] = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobExecutionId, jobExecutionId));
    const [session] = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.id, runnerSessionId));
    expect(afterRunning?.firstHeartbeatAt).toEqual(beforeRunning?.firstHeartbeatAt);
    expect(afterRunning?.lastHeartbeatAt).toEqual(beforeRunning?.lastHeartbeatAt);
    expect(session?.toolCapabilities).toEqual(partialCapabilities);
    expect(session?.toolCapabilitiesReportedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('returns 200 + cancel:true after reconcileTerminalJobExecution', async () => {
    const {jobId, jobExecutionId, workflowRunId, workflowRunAttemptId, leaseToken} =
      await claimAvailableJob();
    await reconcileTerminalJobExecution({jobExecutionId});

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${jobId}/heartbeat`,
      headers: {authorization: `Bearer ${leaseToken}`},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{cancel: boolean; lease_token: string}>();
    expect(body).toEqual({cancel: true, lease_token: expect.any(String)});
    const refreshedLease = getLeaseTokenClaims(body.lease_token);
    expect(refreshedLease).toMatchObject({
      jobId,
      jobExecutionId,
      workflowRunId,
      workflowRunAttemptId,
      runnerSessionId,
    });
  });

  it('preserves current step scope when renewing a step-scoped lease', async () => {
    const {jobId, leaseToken} = await claimAvailableJob();
    const lease = getLeaseTokenClaims(leaseToken);
    if (!lease) throw new Error('Expected valid lease token');
    const stepScope = {currentStepId: crypto.randomUUID(), currentStepAttempt: 3};
    const stepScopedLeaseToken = mintLeaseToken({...lease, ...stepScope});

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${jobId}/heartbeat`,
      headers: {authorization: `Bearer ${stepScopedLeaseToken}`},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{cancel: boolean; lease_token: string}>();
    const refreshedLease = getLeaseTokenClaims(body.lease_token);
    expect(refreshedLease).toMatchObject(stepScope);
  });

  it('returns 404 when the jobId is unknown', async () => {
    const jobId = crypto.randomUUID();
    const jobExecutionId = crypto.randomUUID();
    const leaseToken = mintLeaseToken({
      jobId,
      jobExecutionId,
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      workspaceId,
      runnerSessionId,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${jobId}/heartbeat`,
      headers: {authorization: `Bearer ${leaseToken}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('running-job-execution-not-found');
  });

  it('returns 404 when the job belongs to a different session', async () => {
    const {jobId, jobExecutionId} = await claimAvailableJob();
    const otherSession = await runnerSessionFactory.create({workspaceId});
    const leaseToken = mintLeaseToken({
      jobId,
      jobExecutionId,
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      workspaceId,
      runnerSessionId: otherSession.id,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${jobId}/heartbeat`,
      headers: {authorization: `Bearer ${leaseToken}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('running-job-execution-not-found');
  });

  it('returns 404 when the path job id does not match the lease token job id', async () => {
    const {leaseToken} = await claimAvailableJob();

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${crypto.randomUUID()}/heartbeat`,
      headers: {authorization: `Bearer ${leaseToken}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('lease-job-mismatch');
  });
});
