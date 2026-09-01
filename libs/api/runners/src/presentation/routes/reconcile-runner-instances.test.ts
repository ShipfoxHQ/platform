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
import {config} from '#config.js';
import {db} from '#db/db.js';
import {recordHeartbeat} from '#db/job-executions.js';
import {reservations} from '#db/schema/reservations.js';
import {runnerControlSessions} from '#db/schema/runner-control-sessions.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
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

  it('returns an existing authorization and its first stopping timestamp', async () => {
    const stoppingAt = new Date('2025-01-01T00:00:00.000Z');
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-1',
      state: 'stopping',
      stoppingAt,
      terminationAuthorizedAt: new Date('2025-01-01T00:01:00.000Z'),
      terminationReason: 'job-cancelled',
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
      state: 'stopping',
      stopping_at: stoppingAt.toISOString(),
      desired_intent: 'terminate',
      termination_reason: 'job-cancelled',
    });
  });

  it('omits stopping_at when a runner has no stopping timestamp', async () => {
    await createRunnerInstance({providerRunnerId: 'provisioned-runner-1'});

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {observed_provider_runner_ids: ['provisioned-runner-1']},
    });

    expect(res.statusCode).toBe(200);
    expect(Object.hasOwn(res.json().runners[0], 'stopping_at')).toBe(false);
  });

  it.each([
    {cancellationReason: 'run_cancelled', expectedReason: 'job-cancelled'},
    {cancellationReason: 'timed_out', expectedReason: 'job-timeout'},
  ] as const)('authorizes an expired $cancellationReason with its preserved reason', async ({
    cancellationReason,
    expectedReason,
  }) => {
    const providerRunnerId = `${cancellationReason}-runner`;
    await createRunnerInstance({providerRunnerId});
    await insertRunningJob({
      jobId: crypto.randomUUID(),
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      providerRunnerId,
      lastHeartbeatAt: new Date('2025-01-01T00:01:00.000Z'),
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
      cancellationReason,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {observed_provider_runner_ids: [providerRunnerId]},
    });

    expect(res.statusCode).toBe(200);
    if (cancellationReason === 'timed_out') {
      expect(config.RUNNER_TERMINATION_REASON_JOB_TIMEOUT_ENABLED).toBe(true);
    }
    expect(res.json().runners[0]).toMatchObject({
      desired_intent: 'terminate',
      termination_reason: expectedReason,
    });
    const [runner] = await db()
      .select({terminationReason: providerRunners.terminationReason})
      .from(providerRunners)
      .where(
        and(
          eq(providerRunners.workspaceId, workspaceId),
          eq(providerRunners.provisionerId, provisionerTokenId),
          eq(providerRunners.providerRunnerId, providerRunnerId),
        ),
      );
    expect(runner?.terminationReason).toBe(expectedReason);
  });

  it('returns a durable authorization for an eligible provider termination candidate', async () => {
    await createRunnerInstance({providerRunnerId: 'candidate-runner'});

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        observed_provider_runner_ids: [],
        termination_candidates: [
          {
            provider_runner_id: 'candidate-runner',
            reason: 'registration-deadline',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runners[0]).toMatchObject({
      provider_runner_id: 'candidate-runner',
      desired_intent: 'terminate',
      termination_reason: 'registration-deadline',
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
          eq(providerRunners.providerRunnerId, 'candidate-runner'),
        ),
      );
    expect(runner?.terminationAuthorizedAt).toBeInstanceOf(Date);
    expect(runner?.terminationReason).toBe('registration-deadline');
  });

  it('does not reconcile absent runners for candidate-only requests', async () => {
    await createRunnerInstance({
      providerRunnerId: 'stale-runner',
      reportedAt: new Date(Date.now() - 300_000),
    });
    await createRunnerInstance({providerRunnerId: 'candidate-runner'});

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        observed_provider_runner_ids: ['candidate-runner'],
        termination_candidates: [
          {provider_runner_id: 'candidate-runner', reason: 'registration-deadline'},
        ],
        candidate_only_reconcile: true,
      },
    });

    const [staleRunner] = await db()
      .select({state: providerRunners.state})
      .from(providerRunners)
      .where(
        and(
          eq(providerRunners.workspaceId, workspaceId),
          eq(providerRunners.provisionerId, provisionerTokenId),
          eq(providerRunners.providerRunnerId, 'stale-runner'),
        ),
      );

    expect(res.statusCode).toBe(200);
    expect(res.json().runners[0]).toMatchObject({
      provider_runner_id: 'candidate-runner',
      desired_intent: 'terminate',
      termination_reason: 'registration-deadline',
    });
    expect(res.json().terminated_absent_provider_runner_ids).toEqual([]);
    expect(staleRunner?.state).toBe('running');
  });

  it('keeps a provider termination candidate when a live job exists', async () => {
    await createRunnerInstance({providerRunnerId: 'busy-candidate'});
    await insertRunningJob({
      jobId: crypto.randomUUID(),
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      providerRunnerId: 'busy-candidate',
      lastHeartbeatAt: new Date(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        observed_provider_runner_ids: ['busy-candidate'],
        termination_candidates: [
          {
            provider_runner_id: 'busy-candidate',
            reason: 'registration-deadline',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runners[0]).toMatchObject({
      provider_runner_id: 'busy-candidate',
      desired_intent: 'keep',
    });
    expect(res.json().runners[0]).not.toHaveProperty('termination_reason');
  });

  it('authorizes a provider health failure candidate', async () => {
    await createRunnerInstance({providerRunnerId: 'unhealthy-candidate'});

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        observed_provider_runner_ids: [],
        termination_candidates: [
          {
            provider_runner_id: 'unhealthy-candidate',
            reason: 'provider-health-failed',
          },
        ],
      },
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
          eq(providerRunners.providerRunnerId, 'unhealthy-candidate'),
        ),
      );

    expect(res.statusCode).toBe(200);
    expect(res.json().runners[0]).toMatchObject({
      provider_runner_id: 'unhealthy-candidate',
      desired_intent: 'terminate',
      termination_reason: 'provider-health-failed',
    });
    expect(runner?.terminationAuthorizedAt).toBeInstanceOf(Date);
    expect(runner?.terminationReason).toBe('provider-health-failed');
  });

  it('keeps a candidate for a runner with an enrolled session', async () => {
    const runner = await createRunnerInstance({providerRunnerId: 'enrolled-candidate'});
    await db()
      .insert(runnerSessions)
      .values({
        workspaceId,
        scope: 'workspace',
        registrationTokenId: crypto.randomUUID(),
        registrationTokenKind: 'activation',
        runnerInstanceId: runner.id,
        provisionerId: provisionerTokenId,
        providerRunnerId: 'enrolled-candidate',
        labels: ['linux'],
        maxClaims: 1,
        claimsUsed: 0,
      });

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        observed_provider_runner_ids: [],
        termination_candidates: [
          {provider_runner_id: 'enrolled-candidate', reason: 'registration-deadline'},
        ],
      },
    });

    const [persistedRunner] = await db()
      .select({
        terminationAuthorizedAt: providerRunners.terminationAuthorizedAt,
        terminationReason: providerRunners.terminationReason,
      })
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));

    expect(res.statusCode).toBe(200);
    expect(res.json().runners[0]).toMatchObject({
      provider_runner_id: 'enrolled-candidate',
      desired_intent: 'keep',
    });
    expect(res.json().runners[0]).not.toHaveProperty('termination_reason');
    expect(persistedRunner?.terminationAuthorizedAt).toBeNull();
    expect(persistedRunner?.terminationReason).toBeNull();
  });

  it('keeps a candidate for a runner with an open control session', async () => {
    const runner = await createRunnerInstance({providerRunnerId: 'controlled-candidate'});
    await db()
      .insert(runnerControlSessions)
      .values({
        runnerInstanceId: runner.id,
        provisionerId: provisionerTokenId,
        hashedToken: crypto.randomUUID(),
        prefix: 'test',
        expiresAt: new Date(Date.now() + 60_000),
      });

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        observed_provider_runner_ids: [],
        termination_candidates: [
          {provider_runner_id: 'controlled-candidate', reason: 'registration-deadline'},
        ],
      },
    });

    const [persistedRunner] = await db()
      .select({
        terminationAuthorizedAt: providerRunners.terminationAuthorizedAt,
        terminationReason: providerRunners.terminationReason,
      })
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));

    expect(res.statusCode).toBe(200);
    expect(res.json().runners[0]).toMatchObject({
      provider_runner_id: 'controlled-candidate',
      desired_intent: 'keep',
    });
    expect(res.json().runners[0]).not.toHaveProperty('termination_reason');
    expect(persistedRunner?.terminationAuthorizedAt).toBeNull();
    expect(persistedRunner?.terminationReason).toBeNull();
  });

  it('authorizes a candidate when its control session has expired', async () => {
    const runner = await createRunnerInstance({providerRunnerId: 'expired-candidate'});
    await db()
      .insert(runnerControlSessions)
      .values({
        runnerInstanceId: runner.id,
        provisionerId: provisionerTokenId,
        hashedToken: crypto.randomUUID(),
        prefix: 'test',
        expiresAt: new Date(Date.now() - 60_000),
      });

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        observed_provider_runner_ids: [],
        termination_candidates: [
          {provider_runner_id: 'expired-candidate', reason: 'registration-deadline'},
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runners[0]).toMatchObject({
      provider_runner_id: 'expired-candidate',
      desired_intent: 'terminate',
      termination_reason: 'registration-deadline',
    });
  });

  it('uses the terminal-state reason for a stopped candidate', async () => {
    await createRunnerInstance({providerRunnerId: 'stopped-candidate', state: 'stopped'});

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        observed_provider_runner_ids: [],
        termination_candidates: [
          {provider_runner_id: 'stopped-candidate', reason: 'registration-deadline'},
        ],
      },
    });

    const [runner] = await db()
      .select({terminationReason: providerRunners.terminationReason})
      .from(providerRunners)
      .where(
        and(
          eq(providerRunners.workspaceId, workspaceId),
          eq(providerRunners.provisionerId, provisionerTokenId),
          eq(providerRunners.providerRunnerId, 'stopped-candidate'),
        ),
      );

    expect(res.statusCode).toBe(200);
    expect(res.json().runners[0]).toMatchObject({
      provider_runner_id: 'stopped-candidate',
      state: 'stopped',
      desired_intent: 'terminate',
      termination_reason: 'terminal-state',
    });
    expect(runner?.terminationReason).toBe('terminal-state');
  });

  it('does not authorize a candidate owned by another provisioner', async () => {
    const foreignProvisionerId = crypto.randomUUID();
    const foreignRunner = await providerRunnerFactory.create({
      workspaceId,
      provisionerId: foreignProvisionerId,
      providerRunnerId: 'foreign-candidate',
      state: 'running',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/reconcile',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        observed_provider_runner_ids: [],
        termination_candidates: [
          {provider_runner_id: 'foreign-candidate', reason: 'registration-deadline'},
        ],
      },
    });

    const [persistedRunner] = await db()
      .select({
        terminationAuthorizedAt: providerRunners.terminationAuthorizedAt,
        terminationReason: providerRunners.terminationReason,
      })
      .from(providerRunners)
      .where(eq(providerRunners.id, foreignRunner.id));

    expect(res.statusCode).toBe(200);
    expect(res.json().runners[0]).toMatchObject({
      provider_runner_id: 'foreign-candidate',
      state: null,
      desired_intent: 'keep',
    });
    expect(persistedRunner?.terminationAuthorizedAt).toBeNull();
    expect(persistedRunner?.terminationReason).toBeNull();
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

  it('returns keep for an active runner with a cancelled bound job during cleanup grace', async () => {
    const intentSpy = vi.spyOn(providerRunnerTerminateIntentIssuedCount, 'add');
    await createRunnerInstance({providerRunnerId: 'provisioned-runner-1'});
    const job = await insertRunningJob({
      jobId: crypto.randomUUID(),
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      providerRunnerId: 'provisioned-runner-1',
      lastHeartbeatAt: new Date('2025-01-01T00:00:00.000Z'),
      cancellationRequestedAt: new Date(Date.now() - 1_000),
      cancellationReason: 'run_cancelled',
    });
    const heartbeat = await recordHeartbeat({
      jobExecutionId: job.jobExecutionId,
      runnerSessionId: job.runnerSessionId,
    });
    expect(heartbeat).toMatchObject({
      cancellationRequested: true,
      cancellationReason: 'run_cancelled',
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
        cancellation_requested_at: expect.any(String),
        cancellation_reason: 'run_cancelled',
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
    stoppingAt?: Date | null;
    terminationAuthorizedAt?: Date | null;
    terminationReason?:
      | 'registration-deadline'
      | 'activation-timeout'
      | 'runner-unresponsive'
      | 'lease-expired'
      | 'session-exhausted'
      | 'stopping-timeout'
      | 'provider-health-failed'
      | 'job-cancelled'
      | 'job-timeout'
      | 'terminal-state'
      | null;
  }) {
    return await providerRunnerFactory.create({
      workspaceId,
      provisionerId: provisionerTokenId,
      providerRunnerId: params.providerRunnerId,
      intendedReservationId: params.intendedReservationId ?? null,
      reservationId: params.reservationId ?? null,
      state: params.state ?? 'running',
      reportedAt: params.reportedAt ?? new Date(),
      stoppingAt: params.stoppingAt ?? null,
      terminationAuthorizedAt: params.terminationAuthorizedAt ?? null,
      terminationReason: params.terminationReason ?? null,
    });
  }

  async function insertRunningJob(params: {
    jobId: string;
    workflowRunId: string;
    workflowRunAttemptId: string;
    providerRunnerId: string;
    lastHeartbeatAt: Date;
    cancellationRequestedAt?: Date | null;
    cancellationReason?: 'run_cancelled' | 'timed_out' | null;
  }): Promise<{jobExecutionId: string; runnerSessionId: string}> {
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    const jobExecutionId = crypto.randomUUID();

    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        workflowRunId: params.workflowRunId,
        jobId: params.jobId,
        jobExecutionId,
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
        cancellationReason: params.cancellationReason ?? null,
      });
    return {jobExecutionId, runnerSessionId: runnerSession.id};
  }
});
