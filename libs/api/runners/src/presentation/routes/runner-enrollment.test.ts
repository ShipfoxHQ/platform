import {AUTH_PROVISIONER_TOKEN, AUTH_USER, setProvisionerContext} from '@shipfox/api-auth-context';
import {
  type AuthMethod,
  ClientError,
  closeApp,
  createApp,
  extractBearerToken,
} from '@shipfox/node-fastify';
import {eq} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {reservations} from '#db/schema/reservations.js';
import {runnerActivationTokens} from '#db/schema/runner-activation-tokens.js';
import {runnerBootstrapTokens, runnerControlSessions} from '#db/schema/runner-control-sessions.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {
  createRunnerControlSessionAuthMethod,
  createRunnerRegistrationTokenAuthMethod,
} from '#presentation/auth/index.js';
import {
  fakeLeaseTokenAuthMethod,
  fakeRunnerSessionAuthMethod,
  provisionerTokenFactory,
  runnersTestAuthClient,
} from '#test/index.js';
import {createRunnerRoutes} from './index.js';
import {
  pollForRunnerActivationToken,
  resolveRunnerAssignmentPollWaitSeconds,
} from './runner-enrollment.js';

const token = 'provisioner-test-token';
const workspaceToken = 'workspace-provisioner-test-token';
const fakeUserAuth: AuthMethod = {name: AUTH_USER, authenticate: () => Promise.resolve()};

describe('runner enrollment control plane', () => {
  let app: FastifyInstance;
  let provisionerId: string;
  let workspaceProvisionerId: string;
  let workspaceProvisionerWorkspaceId: string;
  const provisionerAuth: AuthMethod = {
    name: AUTH_PROVISIONER_TOKEN,
    authenticate: (request: FastifyRequest) => {
      const rawToken = extractBearerToken(request.headers.authorization);
      if (rawToken === workspaceToken) {
        setProvisionerContext(request, {
          scope: 'workspace',
          workspaceId: workspaceProvisionerWorkspaceId,
          provisionerTokenId: workspaceProvisionerId,
        });
        return Promise.resolve();
      }
      if (rawToken !== token)
        throw new ClientError('Invalid provisioner token', 'unauthorized', {status: 401});
      setProvisionerContext(request, {scope: 'installation', provisionerTokenId: provisionerId});
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    app = await createApp({
      auth: [
        fakeUserAuth,
        provisionerAuth,
        createRunnerRegistrationTokenAuthMethod(),
        createRunnerControlSessionAuthMethod(),
        fakeRunnerSessionAuthMethod,
        fakeLeaseTokenAuthMethod,
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
    const provisioner = await provisionerTokenFactory.create({scope: 'installation'});
    const workspaceProvisioner = await provisionerTokenFactory.create({
      scope: 'workspace',
    });
    if (workspaceProvisioner.scope !== 'workspace') {
      throw new Error('Expected a workspace provisioner token');
    }
    provisionerId = provisioner.id;
    workspaceProvisionerId = workspaceProvisioner.id;
    workspaceProvisionerWorkspaceId = workspaceProvisioner.workspaceId;
  });

  it('uses the requested assignment wait below the server cap and caps larger requests', () => {
    expect(resolveRunnerAssignmentPollWaitSeconds(5)).toBe(5);
    expect(resolveRunnerAssignmentPollWaitSeconds(0)).toBe(1);
    expect(resolveRunnerAssignmentPollWaitSeconds(30)).toBe(30);
    expect(resolveRunnerAssignmentPollWaitSeconds(31)).toBe(30);
    expect(resolveRunnerAssignmentPollWaitSeconds(undefined)).toBe(30);
  });

  it('creates a hashed one-use bootstrap token and restricts its control session to its instance', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/batch',
      headers: {authorization: `Bearer ${token}`},
      payload: {provider_kind: 'docker', runner_instances: [{template_key: 'linux'}]},
    });

    expect(created.statusCode).toBe(200);
    const runner = created.json().runner_instances[0];
    const [storedBootstrap] = await db()
      .select()
      .from(runnerBootstrapTokens)
      .where(eq(runnerBootstrapTokens.runnerInstanceId, runner.runner_instance_id));
    expect(storedBootstrap?.hashedToken).not.toBe(runner.bootstrap_token);
    expect(storedBootstrap?.consumedAt).toBeNull();

    const exchanged = await app.inject({
      method: 'POST',
      url: '/runner-enrollment/exchange',
      payload: {bootstrap_token: runner.bootstrap_token},
    });

    expect(exchanged.statusCode).toBe(200);
    const controlToken = exchanged.json().control_session_token;
    const reused = await app.inject({
      method: 'POST',
      url: '/runner-enrollment/exchange',
      payload: {bootstrap_token: runner.bootstrap_token},
    });
    expect(reused.statusCode).toBe(401);

    const enrolled = await app.inject({
      method: 'POST',
      url: '/runner-control/enrollment',
      headers: {authorization: `Bearer ${controlToken}`},
      payload: {
        labels: ['Linux', 'linux', 'shipfox-managed'],
        provider_kind: 'docker',
        protocol_version: '1',
      },
    });
    expect(enrolled.statusCode).toBe(200);
    expect(enrolled.json()).toEqual({activation_token: null});

    const attached = await app.inject({
      method: 'POST',
      url: '/runner-control/provider-runner',
      headers: {authorization: `Bearer ${controlToken}`},
      payload: {provider_runner_id: 'container-1'},
    });
    expect(attached.json()).toEqual({attached: true});

    const [instance] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.runner_instance_id));
    expect(instance).toMatchObject({
      provisionerId,
      labels: ['linux', 'shipfox-managed'],
      providerRunnerId: 'container-1',
      state: 'running',
      protocolVersion: '1',
    });
    const [session] = await db()
      .select()
      .from(runnerControlSessions)
      .where(eq(runnerControlSessions.runnerInstanceId, runner.runner_instance_id));
    expect(session?.hashedToken).not.toBe(controlToken);

    const jobs = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${controlToken}`},
    });
    expect(jobs.statusCode).toBe(401);
  });

  it('strips reserved labels when a workspace provisioner enrolls a runner', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/batch',
      headers: {authorization: `Bearer ${workspaceToken}`},
      payload: {runner_instances: [{}]},
    });
    const runner = created.json().runner_instances[0];
    const exchanged = await app.inject({
      method: 'POST',
      url: '/runner-enrollment/exchange',
      payload: {bootstrap_token: runner.bootstrap_token},
    });

    const enrolled = await app.inject({
      method: 'POST',
      url: '/runner-control/enrollment',
      headers: {authorization: `Bearer ${exchanged.json().control_session_token}`},
      payload: {
        labels: ['linux', 'shipfox-managed'],
        provider_kind: 'docker',
        protocol_version: '1',
      },
    });

    const [instance] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.runner_instance_id));

    expect(enrolled.statusCode).toBe(200);
    expect(instance?.labels).toEqual(['linux']);
  });

  it('repairs an intended reservation after a provider report and returns its activation token', async () => {
    const workspaceId = crypto.randomUUID();
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: ['linux'],
        count: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!reservation) throw new Error('Reservation insert returned no row');

    const created = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/batch',
      headers: {authorization: `Bearer ${token}`},
      payload: {
        runner_instances: [{template_key: 'linux', reservation_id: reservation.id}],
      },
    });
    const runner = created.json().runner_instances[0];
    const exchanged = await app.inject({
      method: 'POST',
      url: '/runner-enrollment/exchange',
      payload: {bootstrap_token: runner.bootstrap_token},
    });
    const controlToken = exchanged.json().control_session_token;

    const providerRunnerId = 'container-intended-assignment';
    const attached = await app.inject({
      method: 'POST',
      url: `/provisioners/runner-instances/${runner.runner_instance_id}/provider-runner`,
      headers: {authorization: `Bearer ${token}`},
      payload: {provider_runner_id: providerRunnerId},
    });
    expect(attached.json()).toEqual({attached: true});

    const reported = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/report',
      headers: {authorization: `Bearer ${token}`},
      payload: {
        events: [
          {
            provider_runner_id: providerRunnerId,
            reservation_id: reservation.id,
            template_key: 'linux',
            labels: ['linux'],
            state: 'starting',
            reported_at: new Date().toISOString(),
            provider_kind: 'docker',
          },
        ],
      },
    });
    expect(reported.statusCode).toBe(200);
    expect(reported.json()).toEqual({accepted: 1, reservations_released: 0});

    const [reportedInstance] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.runner_instance_id));
    expect(reportedInstance).toMatchObject({
      workspaceId: null,
      reservationId: reservation.id,
      intendedReservationId: reservation.id,
      assignedAt: null,
      state: 'starting',
      providerRunnerId,
    });

    const enrolled = await app.inject({
      method: 'POST',
      url: '/runner-control/enrollment',
      headers: {authorization: `Bearer ${controlToken}`},
      payload: {labels: ['linux'], provider_kind: 'docker', protocol_version: '1'},
    });

    expect(enrolled.statusCode).toBe(200);
    expect(enrolled.json()).toEqual({activation_token: expect.any(String)});
    const [instance] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.runner_instance_id));
    expect(instance).toMatchObject({
      workspaceId,
      reservationId: reservation.id,
      intendedReservationId: null,
      state: 'running',
      providerRunnerId,
      assignedAt: expect.any(Date),
    });
  });

  it('rejects assignment for a provider-reported runner before enrollment', async () => {
    const workspaceId = crypto.randomUUID();
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: ['linux'],
        count: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!reservation) throw new Error('Reservation insert returned no row');
    const [runner] = await db()
      .insert(providerRunners)
      .values({
        provisionerId,
        intendedReservationId: reservation.id,
        reservationId: reservation.id,
        providerRunnerId: crypto.randomUUID(),
        labels: ['linux'],
        state: 'starting',
        reportedAt: new Date(),
      })
      .returning({id: providerRunners.id});
    if (!runner) throw new Error('Runner instance insert returned no row');

    const assigned = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/assignments',
      headers: {authorization: `Bearer ${token}`},
      payload: {reservation_id: reservation.id, runner_instance_ids: [runner.id]},
    });

    expect(assigned.statusCode).toBe(409);
    expect(assigned.json()).toMatchObject({code: 'runner-instance-not-assignable'});
  });

  it('keeps enrollment successful when an intended reservation cannot be promoted', async () => {
    const workspaceId = crypto.randomUUID();
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: ['gpu'],
        count: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!reservation) throw new Error('Reservation insert returned no row');

    const created = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/batch',
      headers: {authorization: `Bearer ${token}`},
      payload: {runner_instances: [{reservation_id: reservation.id}]},
    });
    const runner = created.json().runner_instances[0];
    const exchanged = await app.inject({
      method: 'POST',
      url: '/runner-enrollment/exchange',
      payload: {bootstrap_token: runner.bootstrap_token},
    });
    const controlToken = exchanged.json().control_session_token;
    await app.inject({
      method: 'POST',
      url: `/provisioners/runner-instances/${runner.runner_instance_id}/provider-runner`,
      headers: {authorization: `Bearer ${token}`},
      payload: {provider_runner_id: 'container-intended-mismatch'},
    });

    const enrolled = await app.inject({
      method: 'POST',
      url: '/runner-control/enrollment',
      headers: {authorization: `Bearer ${controlToken}`},
      payload: {labels: ['linux'], provider_kind: 'docker', protocol_version: '1'},
    });

    expect(enrolled.statusCode).toBe(200);
    expect(enrolled.json()).toEqual({activation_token: null});
    const [instance] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.runner_instance_id));
    expect(instance).toMatchObject({
      workspaceId: null,
      reservationId: null,
      intendedReservationId: reservation.id,
      state: 'running',
    });
  });

  it('rejects enrollment when the authenticated runner instance is terminal', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/batch',
      headers: {authorization: `Bearer ${token}`},
      payload: {runner_instances: [{}]},
    });
    const runner = created.json().runner_instances[0];
    const exchanged = await app.inject({
      method: 'POST',
      url: '/runner-enrollment/exchange',
      payload: {bootstrap_token: runner.bootstrap_token},
    });
    await db()
      .update(providerRunners)
      .set({state: 'failed'})
      .where(eq(providerRunners.id, runner.runner_instance_id));

    const enrolled = await app.inject({
      method: 'POST',
      url: '/runner-control/enrollment',
      headers: {authorization: `Bearer ${exchanged.json().control_session_token}`},
      payload: {labels: ['linux'], provider_kind: 'docker', protocol_version: '1'},
    });

    expect(enrolled.statusCode).toBe(409);
    expect(enrolled.json()).toMatchObject({code: 'runner-control-session-invalid'});
  });

  it('assigns an enrolled runner instance only through the owned reservation', async () => {
    const workspaceId = crypto.randomUUID();
    const created = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/batch',
      headers: {authorization: `Bearer ${token}`},
      payload: {runner_instances: [{template_key: 'linux'}]},
    });
    const runner = created.json().runner_instances[0];
    const exchanged = await app.inject({
      method: 'POST',
      url: '/runner-enrollment/exchange',
      payload: {bootstrap_token: runner.bootstrap_token},
    });
    const controlToken = exchanged.json().control_session_token;
    await app.inject({
      method: 'POST',
      url: '/runner-control/enrollment',
      headers: {authorization: `Bearer ${controlToken}`},
      payload: {labels: ['linux'], provider_kind: 'docker', protocol_version: '1'},
    });
    await app.inject({
      method: 'POST',
      url: '/runner-control/provider-runner',
      headers: {authorization: `Bearer ${controlToken}`},
      payload: {provider_runner_id: 'container-assignment-test'},
    });
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: ['linux'],
        count: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!reservation) throw new Error('Reservation insert returned no row');

    const assigned = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/assignments',
      headers: {authorization: `Bearer ${token}`},
      payload: {reservation_id: reservation.id, runner_instance_ids: [runner.runner_instance_id]},
    });

    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toEqual({runner_instance_ids: [runner.runner_instance_id]});
    const [instance] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.runner_instance_id));
    expect(instance).toMatchObject({
      workspaceId,
      reservationId: reservation.id,
      assignedAt: expect.any(Date),
    });
  });

  it('returns an activation token only for its assigned runner and closes control access after registration', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/batch',
      headers: {authorization: `Bearer ${token}`},
      payload: {runner_instances: [{}]},
    });
    const runner = created.json().runner_instances[0];
    const exchanged = await app.inject({
      method: 'POST',
      url: '/runner-enrollment/exchange',
      payload: {bootstrap_token: runner.bootstrap_token},
    });
    const controlToken = exchanged.json().control_session_token;
    const workspaceId = crypto.randomUUID();
    await db()
      .update(providerRunners)
      .set({
        workspaceId,
        reservationId: crypto.randomUUID(),
        providerRunnerId: 'runner-activation-test',
        state: 'running',
      })
      .where(eq(providerRunners.id, runner.runner_instance_id));

    const assignment = await app.inject({
      method: 'GET',
      url: '/runner-control/assignment?wait_seconds=5',
      headers: {authorization: `Bearer ${controlToken}`},
    });
    expect(assignment.statusCode).toBe(200);
    const activationToken = assignment.json().activation_token;
    expect(typeof activationToken).toBe('string');

    const registered = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${activationToken}`},
      payload: {labels: ['linux']},
    });
    expect(registered.statusCode).toBe(200);
    expect(registered.json()).toMatchObject({mode: 'activation', max_claims: 1});

    const closed = await app.inject({
      method: 'POST',
      url: '/runner-control/heartbeat',
      headers: {authorization: `Bearer ${controlToken}`},
    });
    expect(closed.statusCode).toBe(401);
  });

  it('rejects a negative assignment wait before entering the control-plane poll', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/batch',
      headers: {authorization: `Bearer ${token}`},
      payload: {runner_instances: [{}]},
    });
    const runner = created.json().runner_instances[0];
    const exchanged = await app.inject({
      method: 'POST',
      url: '/runner-enrollment/exchange',
      payload: {bootstrap_token: runner.bootstrap_token},
    });

    const assignment = await app.inject({
      method: 'GET',
      url: '/runner-control/assignment?wait_seconds=-1',
      headers: {authorization: `Bearer ${exchanged.json().control_session_token}`},
    });

    expect(assignment.statusCode).toBe(400);
  });

  it('keeps polling when an assignment cannot yet mint an activation token', async () => {
    vi.useFakeTimers();
    const abortController = new AbortController();
    const getAssignment = vi.fn().mockResolvedValue({workspaceId: 'workspace-id'});
    const issueActivationToken = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('activation-token');
    try {
      const activationToken = pollForRunnerActivationToken({
        deadline: Date.now() + 1_000,
        intervalMs: 5,
        signal: abortController.signal,
        getAssignment,
        issueActivationToken,
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(issueActivationToken).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5);
      await expect(activationToken).resolves.toBe('activation-token');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not read or sleep past the assignment poll deadline', async () => {
    vi.useFakeTimers();
    const abortController = new AbortController();
    const getAssignment = vi.fn().mockResolvedValue(null);
    const issueActivationToken = vi.fn();
    try {
      const activationToken = pollForRunnerActivationToken({
        deadline: Date.now() + 10,
        intervalMs: 100,
        signal: abortController.signal,
        getAssignment,
        issueActivationToken,
      });

      await vi.advanceTimersByTimeAsync(10);

      await expect(activationToken).resolves.toBeNull();
      expect(getAssignment).toHaveBeenCalledTimes(1);
      expect(issueActivationToken).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects registration with an expired activation token', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/batch',
      headers: {authorization: `Bearer ${token}`},
      payload: {runner_instances: [{}]},
    });
    const runner = created.json().runner_instances[0];
    const exchanged = await app.inject({
      method: 'POST',
      url: '/runner-enrollment/exchange',
      payload: {bootstrap_token: runner.bootstrap_token},
    });
    const workspaceId = crypto.randomUUID();
    await db()
      .update(providerRunners)
      .set({
        workspaceId,
        reservationId: crypto.randomUUID(),
        providerRunnerId: 'runner-expired',
        state: 'running',
      })
      .where(eq(providerRunners.id, runner.runner_instance_id));
    const assignment = await app.inject({
      method: 'GET',
      url: '/runner-control/assignment',
      headers: {authorization: `Bearer ${exchanged.json().control_session_token}`},
    });
    const activationToken = assignment.json().activation_token;
    await db()
      .update(runnerActivationTokens)
      .set({expiresAt: new Date(Date.now() - 1_000)})
      .where(eq(runnerActivationTokens.runnerInstanceId, runner.runner_instance_id));

    const registered = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${activationToken}`},
      payload: {labels: ['linux']},
    });

    expect(registered.statusCode).toBe(401);
  });
});
