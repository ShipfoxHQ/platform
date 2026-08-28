import {
  AUTH_LEASED_JOB,
  AUTH_PROVISIONER_TOKEN,
  AUTH_RUNNER_REGISTRATION_TOKEN,
  AUTH_RUNNER_SESSION,
  AUTH_USER,
  setProvisionerContext,
} from '@shipfox/api-auth-context';
import {
  RECONCILE_RUNNER_INSTANCES_INTENDED_RESERVATION_HEADER,
  RECONCILE_RUNNER_INSTANCES_INTENDED_RESERVATION_HEADER_VALUE,
} from '@shipfox/api-runners-dto';
import {
  type AuthMethod,
  ClientError,
  closeApp,
  createApp,
  extractBearerToken,
} from '@shipfox/node-fastify';
import {vi} from '@shipfox/vitest/vi';
import {and, desc, eq} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {reservations} from '#db/schema/reservations.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {runningJobExecutions} from '#db/schema/running-job-executions.js';
import {
  providerRunnerAbsentTerminatedCount,
  providerRunnerReconcileCallCount,
  providerRunnerTerminateIntentIssuedCount,
  reservationReleasedCount,
} from '#metrics/instance.js';
import {
  providerRunnerFactory,
  reservationFactory,
  runnerSessionFactory,
  runnersTestAuthClient,
} from '#test/index.js';
import {createRunnerRoutes} from './index.js';

const VALID_PROVISIONER_TOKEN = 'valid-provisioner-token';

const passthroughAuth = (name: string): AuthMethod => ({
  name,
  authenticate: () => Promise.resolve(),
});

describe('POST /provisioners/runner-instances/reconcile', () => {
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

  it('returns keep for an observed running runner and includes its bound job', async () => {
    const jobId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    const workflowRunAttemptId = crypto.randomUUID();
    const intendedReservationId = crypto.randomUUID();
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-1',
      intendedReservationId,
    });
    await insertRunningJob({
      jobId,
      workflowRunId,
      workflowRunAttemptId,
      providerRunnerId: 'provisioned-runner-1',
      lastHeartbeatAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {
        authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`,
        [RECONCILE_RUNNER_INSTANCES_INTENDED_RESERVATION_HEADER]:
          RECONCILE_RUNNER_INSTANCES_INTENDED_RESERVATION_HEADER_VALUE,
      },
      payload: {observed_provider_runner_ids: ['provisioned-runner-1']},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      runners: [
        {
          provider_runner_id: 'provisioned-runner-1',
          state: 'running',
          intended_reservation_id: intendedReservationId,
          reservation_id: null,
          runner_session_id: null,
          bound_job: {
            job_id: jobId,
            workflow_run_attempt_id: workflowRunAttemptId,
            last_heartbeat_at: '2025-01-01T00:00:00.000Z',
            cancellation_requested_at: null,
          },
          desired_intent: 'keep',
        },
      ],
      terminated_absent_provider_runner_ids: [],
    });
  });

  it('omits the additive reservation field for legacy provisioners', async () => {
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-1',
      intendedReservationId: crypto.randomUUID(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {observed_provider_runner_ids: ['provisioned-runner-1']},
    });

    expect(res.statusCode).toBe(200);
    expect(Object.hasOwn(res.json().runners[0], 'intended_reservation_id')).toBe(false);
  });

  it('returns terminate for an observed terminal runner', async () => {
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-1',
      state: 'stopped',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {observed_provider_runner_ids: ['provisioned-runner-1']},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runners[0]).toMatchObject({
      provider_runner_id: 'provisioned-runner-1',
      state: 'stopped',
      desired_intent: 'terminate',
      termination_reason: 'terminal-state',
    });
    const [runner] = await db()
      .select({
        terminationAuthorizedAt: providerRunners.terminationAuthorizedAt,
        terminationReason: providerRunners.terminationReason,
      })
      .from(providerRunners)
      .where(
        and(
          eq(providerRunners.workspaceId, workspaceId),
          eq(providerRunners.provisionerId, provisionerTokenId),
          eq(providerRunners.providerRunnerId, 'provisioned-runner-1'),
        ),
      );
    expect(runner?.terminationAuthorizedAt).toBeInstanceOf(Date);
    expect(runner?.terminationReason).toBe('terminal-state');
  });

  it('returns keep for orphan observed ids without leaking ownership details', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {observed_provider_runner_ids: ['orphan-runner']},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runners[0]).toMatchObject({
      provider_runner_id: 'orphan-runner',
      state: null,
      desired_intent: 'keep',
    });
  });

  it('returns keep for an active runner with a cancelled bound job', async () => {
    const intentSpy = vi.spyOn(providerRunnerTerminateIntentIssuedCount, 'add');
    await createRunnerInstance({providerRunnerId: 'provisioned-runner-1'});
    await insertRunningJob({
      jobId: crypto.randomUUID(),
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      providerRunnerId: 'provisioned-runner-1',
      lastHeartbeatAt: new Date('2025-01-01T00:00:00.000Z'),
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });
    const intentCallsBefore = intentSpy.mock.calls.length;

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {observed_provider_runner_ids: ['provisioned-runner-1']},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runners[0]).toMatchObject({
      desired_intent: 'keep',
      bound_job: {
        cancellation_requested_at: '2025-01-01T00:01:00.000Z',
      },
    });
    expect(Object.hasOwn(res.json().runners[0], 'termination_reason')).toBe(false);
    const intentCalls = intentSpy.mock.calls
      .slice(intentCallsBefore)
      .filter(
        ([value, attributes]) =>
          value === 1 &&
          JSON.stringify(attributes) ===
            JSON.stringify({surface: 'reconcile', reason: 'job-cancelled'}),
      );
    expect(intentCalls).toHaveLength(0);
  });

  it('returns an empty result for an empty observed set without reaping absent runners', async () => {
    const reconcileSpy = vi.spyOn(providerRunnerReconcileCallCount, 'add');
    const reservationId = await createReservation(2);
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-1',
      reservationId,
      reportedAt: new Date(Date.now() - 300_000),
    });
    const reconcileCallsBefore = reconcileSpy.mock.calls.length;

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {observed_provider_runner_ids: []},
    });

    const [providerRunner] = await db()
      .select()
      .from(providerRunners)
      .where(
        and(
          eq(providerRunners.workspaceId, workspaceId),
          eq(providerRunners.provisionerId, provisionerTokenId),
          eq(providerRunners.providerRunnerId, 'provisioned-runner-1'),
        ),
      );
    const [reservation] = await db()
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservationId));

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      runners: [],
      terminated_absent_provider_runner_ids: [],
    });
    expect(providerRunner?.state).toBe('running');
    expect(reservation?.count).toBe(2);
    expect(
      reconcileSpy.mock.calls
        .slice(reconcileCallsBefore)
        .filter(([value, attributes]) => value === 1 && attributes === undefined),
    ).toHaveLength(1);
  });

  it('increments the reservation release metric when reconcile reaps an absent runner', async () => {
    const reconcileSpy = vi.spyOn(providerRunnerReconcileCallCount, 'add');
    const absentSpy = vi.spyOn(providerRunnerAbsentTerminatedCount, 'add');
    const addSpy = vi.spyOn(reservationReleasedCount, 'add');
    const reservationId = await createReservation(3);
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-1',
      reservationId,
      reportedAt: new Date(Date.now() - 300_000),
    });
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-2',
      reservationId,
      reportedAt: new Date(Date.now() - 300_000),
    });
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-3',
      reportedAt: new Date(Date.now() - 300_000),
    });
    const reconcileCallsBefore = reconcileSpy.mock.calls.length;
    const absentCallsBefore = absentSpy.mock.calls.length;
    const addCallsBefore = addSpy.mock.calls.length;

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {observed_provider_runner_ids: ['observed-runner']},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().terminated_absent_provider_runner_ids).toEqual([
      'provisioned-runner-1',
      'provisioned-runner-2',
      'provisioned-runner-3',
    ]);
    expect(
      reconcileSpy.mock.calls
        .slice(reconcileCallsBefore)
        .filter(([value, attributes]) => value === 1 && attributes === undefined),
    ).toHaveLength(1);
    expect(
      absentSpy.mock.calls
        .slice(absentCallsBefore)
        .filter(([value, attributes]) => value === 3 && attributes === undefined),
    ).toHaveLength(1);
    expect(
      addSpy.mock.calls
        .slice(addCallsBefore)
        .filter(([value, attributes]) => value === 2 && attributes?.surface === 'reconcile'),
    ).toHaveLength(1);
  });

  it('returns 401 without valid provisioner auth', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      payload: {observed_provider_runner_ids: []},
    });
    const invalid = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: 'Bearer invalid'},
      payload: {observed_provider_runner_ids: []},
    });

    expect(missing.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
  });

  async function createReservation(count: number): Promise<string> {
    await reservationFactory.create({
      workspaceId,
      provisionerId: provisionerTokenId,
      requiredLabels: ['linux'],
      count,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [reservation] = await db()
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.workspaceId, workspaceId),
          eq(reservations.provisionerId, provisionerTokenId),
        ),
      )
      .orderBy(desc(reservations.id))
      .limit(1);
    if (!reservation) throw new Error('Expected reservation');
    return reservation.id;
  }

  async function createRunnerInstance(params: {
    providerRunnerId: string;
    state?: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'terminated';
    intendedReservationId?: string | null;
    reservationId?: string | null;
    reportedAt?: Date;
  }) {
    return await providerRunnerFactory.create({
      workspaceId,
      provisionerId: provisionerTokenId,
      providerRunnerId: params.providerRunnerId,
      intendedReservationId: params.intendedReservationId ?? null,
      reservationId: params.reservationId ?? null,
      state: params.state ?? 'running',
      reportedAt: params.reportedAt ?? new Date(),
    });
  }

  async function insertRunningJob(params: {
    jobId: string;
    workflowRunId: string;
    workflowRunAttemptId: string;
    providerRunnerId: string;
    lastHeartbeatAt: Date;
    cancellationRequestedAt?: Date | null;
  }) {
    const runnerSession = await runnerSessionFactory.create({workspaceId});

    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        workflowRunId: params.workflowRunId,
        jobId: params.jobId,
        jobExecutionId: crypto.randomUUID(),
        workflowRunAttemptId: params.workflowRunAttemptId,
        projectId: crypto.randomUUID(),
        runnerSessionId: runnerSession.id,
        provisionerId: provisionerTokenId,
        providerRunnerId: params.providerRunnerId,
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
        startedAt: params.lastHeartbeatAt,
        lastHeartbeatAt: params.lastHeartbeatAt,
        cancellationRequestedAt: params.cancellationRequestedAt ?? null,
      });
  }
});
