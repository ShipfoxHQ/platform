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
import {eq} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {provisionerCapabilitySnapshots} from '#db/schema/provisioner-capability-snapshots.js';
import {runningJobExecutions} from '#db/schema/running-job-executions.js';
import {
  providerRunnerCountDivergenceCount,
  providerRunnerTerminateIntentIssuedCount,
} from '#metrics/instance.js';
import {
  pendingJobFactory,
  providerRunnerFactory,
  runnerSessionFactory,
  runnersTestAuthClient,
} from '#test/index.js';
import {createRunnerRoutes} from './index.js';

const VALID_PROVISIONER_TOKEN = 'valid-provisioner-token';
const INSTALLATION_PROVISIONER_TOKEN = 'installation-provisioner-token';

const passthroughAuth = (name: string): AuthMethod => ({
  name,
  authenticate: () => Promise.resolve(),
});

describe('POST /provisioners/demand/poll', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let provisionerTokenId: string;

  const fakeProvisionerAuth: AuthMethod = {
    name: AUTH_PROVISIONER_TOKEN,
    authenticate: (request: FastifyRequest) => {
      const rawToken = extractBearerToken(request.headers.authorization);
      if (rawToken !== VALID_PROVISIONER_TOKEN) {
        if (rawToken === INSTALLATION_PROVISIONER_TOKEN) {
          setProvisionerContext(request, {scope: 'installation', provisionerTokenId});
          return Promise.resolve();
        }
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

  it('returns demand stats and reservations when matching demand exists', async () => {
    await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body({max_reservations: 1}),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      stats: [{labels: ['linux'], queued: 1, reserved: 1}],
      reservations: [{labels: ['linux'], count: 1}],
      terminate_provider_runner_ids: [],
    });
    expect(res.json().reservations[0].reservation_id).toEqual(expect.any(String));
    expect(res.json().reservations[0].expires_at).toEqual(expect.any(String));
  });

  it('rejects installation provisioner credentials from workspace demand polling', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: `Bearer ${INSTALLATION_PROVISIONER_TOKEN}`},
      payload: body({max_reservations: 1}),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });

  it('returns stats without reservations in observe-only mode', async () => {
    await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        wait_seconds: 0,
        max_reservations: 0,
        templates: [
          {
            template_key: 'linux',
            labels: ['linux'],
            available_slots: 1,
            starting: 0,
            running: 1,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      stats: [{labels: ['linux'], queued: 1, reserved: 0}],
      reservations: [],
      terminate_provider_runner_ids: [],
    });
    const snapshots = await db()
      .select()
      .from(provisionerCapabilitySnapshots)
      .where(eq(provisionerCapabilitySnapshots.provisionerId, provisionerTokenId));
    expect(snapshots).toEqual([
      expect.objectContaining({
        workspaceId,
        labels: ['linux'],
        availableSlots: 1,
        starting: 0,
        running: 1,
      }),
    ]);

    const withdrawal = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {wait_seconds: 0, max_reservations: 0, templates: []},
    });
    const clearedSnapshots = await db()
      .select()
      .from(provisionerCapabilitySnapshots)
      .where(eq(provisionerCapabilitySnapshots.provisionerId, provisionerTokenId));

    expect(withdrawal.statusCode).toBe(200);
    expect(clearedSnapshots).toEqual([]);
  });

  it('returns terminate intent ids for active provisioned runners with cancelled latest jobs', async () => {
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId: provisionerTokenId,
      providerRunnerId: 'provisioned-runner-1',
      state: 'running',
    });
    await insertRunningJob({
      providerRunnerId: 'provisioned-runner-1',
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        wait_seconds: 0,
        max_reservations: 0,
        templates: [
          {
            template_key: 'linux',
            labels: ['linux'],
            available_slots: 1,
            starting: 0,
            running: 1,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      reservations: [],
      terminate_provider_runner_ids: ['provisioned-runner-1'],
    });
  });

  it('records count divergence and terminate-intent metrics for the returned poll result', async () => {
    const divergenceSpy = vi.spyOn(providerRunnerCountDivergenceCount, 'add');
    const intentSpy = vi.spyOn(providerRunnerTerminateIntentIssuedCount, 'add');
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId: provisionerTokenId,
      providerRunnerId: 'provisioned-runner-1',
      templateKey: 'linux',
      state: 'running',
    });
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId: provisionerTokenId,
      providerRunnerId: 'provisioned-runner-2',
      templateKey: 'linux',
      state: 'running',
    });
    await insertRunningJob({
      providerRunnerId: 'provisioned-runner-1',
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });
    const divergenceCallsBefore = divergenceSpy.mock.calls.length;
    const intentCallsBefore = intentSpy.mock.calls.length;

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        wait_seconds: 0,
        max_reservations: 0,
        templates: [
          {
            template_key: 'linux',
            labels: ['linux'],
            available_slots: 1,
            starting: 0,
            running: 1,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      reservations: [],
      terminate_provider_runner_ids: ['provisioned-runner-1'],
    });
    const divergenceCalls = divergenceSpy.mock.calls
      .slice(divergenceCallsBefore)
      .filter(
        ([value, attributes]) =>
          value === 1 &&
          JSON.stringify(attributes) ===
            JSON.stringify({state: 'running', direction: 'backend-higher'}),
      );
    const intentCalls = intentSpy.mock.calls
      .slice(intentCallsBefore)
      .filter(
        ([value, attributes]) =>
          value === 1 &&
          JSON.stringify(attributes) ===
            JSON.stringify({surface: 'poll-demand', reason: 'job-cancelled'}),
      );
    expect(divergenceCalls).toHaveLength(1);
    expect(intentCalls).toHaveLength(1);
  });

  it('returns 400 for max reservations above the request bound', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body({max_reservations: 1001}),
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for more than 1000 templates', async () => {
    const templates = Array.from({length: 1001}, (_, index) => ({
      template_key: `linux-${index}`,
      labels: ['linux'],
      available_slots: 1,
      starting: 0,
      running: 0,
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {wait_seconds: 0, max_reservations: 1, templates},
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without authorization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      payload: body({max_reservations: 1}),
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with invalid authorization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: 'Bearer invalid'},
      payload: body({max_reservations: 1}),
    });

    expect(res.statusCode).toBe(401);
  });

  function body(params: {max_reservations: number}) {
    return {
      wait_seconds: 0,
      max_reservations: params.max_reservations,
      templates: [
        {
          template_key: 'linux',
          labels: ['linux'],
          available_slots: 1,
          starting: 0,
          running: 0,
        },
      ],
    };
  }

  async function insertRunningJob(params: {
    providerRunnerId: string;
    cancellationRequestedAt?: Date | null;
  }) {
    const runnerSession = await runnerSessionFactory.create({workspaceId});

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
        providerRunnerId: params.providerRunnerId,
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
        startedAt: new Date('2025-01-01T00:00:00.000Z'),
        lastHeartbeatAt: new Date('2025-01-01T00:00:00.000Z'),
        cancellationRequestedAt: params.cancellationRequestedAt ?? null,
      });
  }
});

describe('POST /provisioners/demand/poll with installation provisioning configured', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let provisionerTokenId: string;

  const fakeProvisionerAuth: AuthMethod = {
    name: AUTH_PROVISIONER_TOKEN,
    authenticate: (request: FastifyRequest) => {
      const rawToken = extractBearerToken(request.headers.authorization);
      if (rawToken === INSTALLATION_PROVISIONER_TOKEN) {
        setProvisionerContext(request, {scope: 'installation', provisionerTokenId});
        return Promise.resolve();
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
      routes: createRunnerRoutes(runnersTestAuthClient, {
        installationProvisioning: {
          policy: {filterEligibleWorkspaceIds: vi.fn().mockResolvedValue(new Set())},
        },
      }),
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

  it('returns opaque empty demand when no workspace is eligible', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: `Bearer ${INSTALLATION_PROVISIONER_TOKEN}`},
      payload: body({max_reservations: 1}),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({stats: [], reservations: [], terminate_provider_runner_ids: []});
  });

  it('still serves workspace provisioner credentials', async () => {
    await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body({max_reservations: 1}),
    });

    expect(res.statusCode).toBe(200);
  });

  function body(params: {max_reservations: number}) {
    return {
      wait_seconds: 0,
      max_reservations: params.max_reservations,
      templates: [
        {
          template_key: 'linux',
          labels: ['linux'],
          available_slots: 1,
          starting: 0,
          running: 0,
        },
      ],
    };
  }
});
