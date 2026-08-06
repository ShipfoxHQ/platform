import {
  AUTH_LEASED_JOB,
  AUTH_PROVISIONER_TOKEN,
  AUTH_RUNNER_REGISTRATION_TOKEN,
  AUTH_RUNNER_SESSION,
  AUTH_USER,
  setProvisionerContext,
} from '@shipfox/api-auth-context';
import {
  type AuthMethod,
  ClientError,
  closeApp,
  createApp,
  extractBearerToken,
} from '@shipfox/node-fastify';
import {vi} from '@shipfox/vitest/vi';
import {and, eq} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {runningJobExecutions} from '#db/schema/running-job-executions.js';
import {providerRunnerTerminateIntentHonoredCount} from '#metrics/instance.js';
import {providerRunnerFactory, runnerSessionFactory, runnersTestAuthClient} from '#test/index.js';
import {createRunnerRoutes} from './index.js';

const VALID_PROVISIONER_TOKEN = 'valid-provisioner-token';

const passthroughAuth = (name: string): AuthMethod => ({
  name,
  authenticate: () => Promise.resolve(),
});

describe('POST /provisioners/runner-instances/report', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let provisionerTokenId: string;

  const fakeProvisionerAuth: AuthMethod = {
    name: AUTH_PROVISIONER_TOKEN,
    authenticate: (request: FastifyRequest) => {
      const rawToken = extractBearerToken(request.headers.authorization);
      if (rawToken !== VALID_PROVISIONER_TOKEN) {
        throw new ClientError('Invalid provisioner token', 'unauthorized', {status: 401});
      }
      setProvisionerContext(request, {scope: 'workspace', workspaceId, provisionerTokenId});
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    app = await createApp({
      auth: [
        passthroughAuth(AUTH_USER),
        passthroughAuth(AUTH_RUNNER_REGISTRATION_TOKEN),
        passthroughAuth(AUTH_RUNNER_SESSION),
        passthroughAuth(AUTH_LEASED_JOB),
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

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    provisionerTokenId = crypto.randomUUID();
  });

  it('accepts provisioned runner lifecycle reports from provisioner auth', async () => {
    const reportedAt = '2025-01-01T00:00:00.000Z';

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/report',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        events: [
          {
            provider_runner_id: 'provisioned-runner-1',
            labels: ['linux'],
            state: 'starting',
            reported_at: reportedAt,
            provider_kind: 'docker',
          },
        ],
      },
    });

    const rows = await db()
      .select()
      .from(providerRunners)
      .where(
        and(
          eq(providerRunners.workspaceId, workspaceId),
          eq(providerRunners.provisionerId, provisionerTokenId),
        ),
      );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({accepted: 1, reservations_released: 0});
    expect(rows[0]).toMatchObject({
      workspaceId,
      provisionerId: provisionerTokenId,
      providerRunnerId: 'provisioned-runner-1',
      state: 'starting',
      labels: ['linux'],
      providerKind: 'docker',
    });
    expect(rows[0]?.reportedAt.toISOString()).toBe(reportedAt);
  });

  it('strips reserved labels from workspace runner reports', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/report',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        events: [
          {
            provider_runner_id: 'provisioned-runner-reserved-label',
            labels: ['linux', 'shipfox-managed'],
            state: 'starting',
            reported_at: new Date('2025-01-01T00:00:00.000Z').toISOString(),
            provider_kind: 'docker',
          },
        ],
      },
    });

    const [row] = await db()
      .select()
      .from(providerRunners)
      .where(
        and(
          eq(providerRunners.workspaceId, workspaceId),
          eq(providerRunners.provisionerId, provisionerTokenId),
          eq(providerRunners.providerRunnerId, 'provisioned-runner-reserved-label'),
        ),
      );

    expect(res.statusCode).toBe(200);
    expect(row?.labels).toEqual(['linux']);
  });

  it('returns 400 when the batch exceeds the DTO limit', async () => {
    const event = {
      provider_runner_id: 'provisioned-runner-1',
      labels: ['linux'],
      state: 'running',
      reported_at: new Date().toISOString(),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/report',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        events: Array.from({length: 1001}, (_, index) => ({
          ...event,
          provider_runner_id: `provisioned-runner-${index}`,
        })),
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('increments the honored terminate-intent metric once for a terminated report', async () => {
    const honoredSpy = vi.spyOn(providerRunnerTerminateIntentHonoredCount, 'add');
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId: provisionerTokenId,
      providerRunnerId: 'provisioned-runner-1',
      state: 'running',
    });
    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        jobId: crypto.randomUUID(),
        jobExecutionId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        runnerSessionId: runnerSession.id,
        provisionerId: provisionerTokenId,
        providerRunnerId: 'provisioned-runner-1',
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
        startedAt: new Date('2025-01-01T00:00:00.000Z'),
        lastHeartbeatAt: new Date('2025-01-01T00:00:00.000Z'),
        cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
      });
    const honoredCallsBefore = honoredSpy.mock.calls.length;

    const first = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/report',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        events: [
          {
            provider_runner_id: 'provisioned-runner-1',
            labels: ['linux'],
            state: 'terminated',
            reported_at: new Date().toISOString(),
          },
        ],
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/report',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        events: [
          {
            provider_runner_id: 'provisioned-runner-1',
            labels: ['linux'],
            state: 'terminated',
            reported_at: new Date().toISOString(),
          },
        ],
      },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const honoredCalls = honoredSpy.mock.calls
      .slice(honoredCallsBefore)
      .filter(
        ([value, attributes]) =>
          value === 1 && JSON.stringify(attributes) === JSON.stringify({reason: 'job-cancelled'}),
      );
    expect(honoredCalls).toHaveLength(1);
  });

  it('returns 400 for provider-sensitive extra fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/report',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        events: [
          {
            provider_runner_id: 'provisioned-runner-1',
            labels: ['linux'],
            state: 'running',
            reported_at: new Date().toISOString(),
            hostname: 'worker-1',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without provisioner auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/report',
      payload: {
        events: [
          {
            provider_runner_id: 'provisioned-runner-1',
            labels: ['linux'],
            state: 'running',
            reported_at: new Date().toISOString(),
          },
        ],
      },
    });

    expect(res.statusCode).toBe(401);
  });
});
