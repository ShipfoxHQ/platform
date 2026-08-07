import {AUTH_PROVISIONER_TOKEN, AUTH_USER, setProvisionerContext} from '@shipfox/api-auth-context';
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
import {reservations} from '#db/schema/reservations.js';
import {runnerControlSessions} from '#db/schema/runner-control-sessions.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
import {runnerReservationPromotionFailureCount} from '#metrics/instance.js';
import {
  createRunnerControlSessionAuthMethod,
  createRunnerRegistrationTokenAuthMethod,
} from '#presentation/auth/index.js';
import {
  arrangeDeletedRunnerEnrollment,
  arrangeExpiredRunnerEnrollment,
  fakeLeaseTokenAuthMethod,
  fakeRunnerSessionAuthMethod,
  pendingJobFactory,
  provisionerTokenFactory,
  runnersTestAuthClient,
} from '#test/index.js';
import {createRunnerRoutes} from './index.js';

let workspaceToken: string;
const fakeUserAuth: AuthMethod = {name: AUTH_USER, authenticate: () => Promise.resolve()};

describe('late runner enrollment recovery', () => {
  let app: FastifyInstance;
  let provisionerId: string;
  let workspaceId: string;

  const provisionerAuth: AuthMethod = {
    name: AUTH_PROVISIONER_TOKEN,
    authenticate: (request: FastifyRequest) => {
      if (extractBearerToken(request.headers.authorization) !== workspaceToken)
        throw new ClientError('Invalid provisioner token', 'unauthorized', {status: 401});
      setProvisionerContext(request, {
        scope: 'workspace',
        workspaceId,
        provisionerTokenId: provisionerId,
      });
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
    workspaceId = crypto.randomUUID();
    workspaceToken = `late-runner-workspace-provisioner-${crypto.randomUUID()}`;
    const provisioner = await provisionerTokenFactory.create(
      {scope: 'workspace', workspaceId},
      {transient: {rawToken: workspaceToken}},
    );
    provisionerId = provisioner.id;
  });

  it('keeps an enrolled runner recoverable when its reservation expires first', async () => {
    const arrangement = await arrangeExpiredRunnerEnrollment({provisionerId, workspaceId});
    const failureSpy = vi.spyOn(runnerReservationPromotionFailureCount, 'add');

    try {
      await enrollRunner(arrangement.controlSessionToken);

      expect(failureSpy).toHaveBeenCalledWith(1, {reason: 'reservation-expired'});
    } finally {
      failureSpy.mockRestore();
    }

    const [runner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, arrangement.runnerInstanceId));
    expect(runner).toMatchObject({
      workspaceId: null,
      reservationId: null,
      intendedReservationId: arrangement.reservationId,
      assignedAt: null,
      runnerSessionId: null,
      state: 'running',
      providerRunnerId: expect.any(String),
    });
  });

  it('keeps an enrolled runner recoverable when its reservation was swept away', async () => {
    const arrangement = await arrangeDeletedRunnerEnrollment({provisionerId, workspaceId});
    const failureSpy = vi.spyOn(runnerReservationPromotionFailureCount, 'add');

    try {
      await enrollRunner(arrangement.controlSessionToken);

      expect(failureSpy).toHaveBeenCalledWith(1, {reason: 'reservation-not-found'});
    } finally {
      failureSpy.mockRestore();
    }

    const [runner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, arrangement.runnerInstanceId));
    expect(runner).toMatchObject({
      workspaceId: null,
      reservationId: null,
      intendedReservationId: arrangement.reservationId,
      assignedAt: null,
      runnerSessionId: null,
      state: 'running',
      providerRunnerId: expect.any(String),
    });
  });

  it('rebinds a stranded runner through activation and claims its pending job', async () => {
    const arrangement = await arrangeExpiredRunnerEnrollment({provisionerId, workspaceId});
    await enrollRunner(arrangement.controlSessionToken);
    const pendingJob = await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});

    const demand = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: `Bearer ${workspaceToken}`},
      payload: {
        wait_seconds: 0,
        max_reservations: 1,
        reservation_ttl_seconds: 60,
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

    expect(demand.statusCode).toBe(200);
    const reboundReservationId = demand.json().reservations[0]?.reservation_id;
    expect(reboundReservationId).toEqual(expect.any(String));

    const [reboundRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, arrangement.runnerInstanceId));
    expect(reboundRunner).toMatchObject({
      workspaceId,
      reservationId: reboundReservationId,
      intendedReservationId: null,
      assignedAt: expect.any(Date),
      runnerSessionId: null,
      state: 'running',
    });

    const assignment = await app.inject({
      method: 'GET',
      url: '/runner-control/assignment?wait_seconds=1',
      headers: {authorization: `Bearer ${arrangement.controlSessionToken}`},
    });
    expect(assignment.statusCode).toBe(200);
    const activationToken = assignment.json().activation_token;
    expect(activationToken).toEqual(expect.any(String));

    const registered = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${activationToken}`},
      payload: {labels: ['linux']},
    });
    expect(registered.statusCode).toBe(200);
    expect(registered.json()).toMatchObject({mode: 'activation', max_claims: 1});

    const claimed = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${registered.json().session_token}`},
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json()).toMatchObject({job_id: pendingJob.jobId});

    const [session] = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.id, registered.json().session_id));
    expect(session).toMatchObject({
      registrationTokenKind: 'activation',
      runnerInstanceId: arrangement.runnerInstanceId,
      provisionerId,
      providerRunnerId: reboundRunner?.providerRunnerId,
      maxClaims: 1,
      claimsUsed: 1,
    });
  });

  it('preserves a rebound assignment across stale provider reports and releases it once', async () => {
    const providerRunnerId = `stale-assignment-${crypto.randomUUID()}`;
    const firstReportAt = new Date(Date.now() - 2_000);
    const [staleReservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: ['linux'],
        count: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning({id: reservations.id});
    if (!staleReservation) throw new Error('Expected stale reservation');

    const initialReport = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/report',
      headers: {authorization: `Bearer ${workspaceToken}`},
      payload: {
        events: [
          {
            provider_runner_id: providerRunnerId,
            reservation_id: staleReservation.id,
            template_key: 'linux',
            labels: ['linux'],
            state: 'running',
            reported_at: firstReportAt.toISOString(),
            provider_kind: 'docker',
          },
        ],
      },
    });

    expect(initialReport.statusCode).toBe(200);
    expect(initialReport.json()).toEqual({accepted: 1, reservations_released: 0});

    const [reportedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(
        and(
          eq(providerRunners.provisionerId, provisionerId),
          eq(providerRunners.providerRunnerId, providerRunnerId),
        ),
      );
    if (!reportedRunner) throw new Error('Expected reported runner');
    expect(reportedRunner).toMatchObject({
      workspaceId,
      reservationId: staleReservation.id,
      state: 'running',
    });

    await db()
      .insert(runnerControlSessions)
      .values({
        runnerInstanceId: reportedRunner.id,
        provisionerId,
        hashedToken: crypto.randomUUID(),
        prefix: 'test',
        expiresAt: new Date(Date.now() + 60_000),
      });
    await db()
      .update(reservations)
      .set({expiresAt: new Date(Date.now() - 1_000)})
      .where(eq(reservations.id, staleReservation.id));
    await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});

    const demand = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: `Bearer ${workspaceToken}`},
      payload: {
        wait_seconds: 0,
        max_reservations: 1,
        reservation_ttl_seconds: 60,
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

    expect(demand.statusCode).toBe(200);
    const reboundReservationId = demand.json().reservations[0]?.reservation_id;
    expect(reboundReservationId).toEqual(expect.any(String));
    expect(reboundReservationId).not.toBe(staleReservation.id);

    const staleReport = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/report',
      headers: {authorization: `Bearer ${workspaceToken}`},
      payload: {
        events: [
          {
            provider_runner_id: providerRunnerId,
            reservation_id: staleReservation.id,
            template_key: 'linux',
            labels: ['linux'],
            state: 'running',
            reported_at: new Date(firstReportAt.getTime() + 1_000).toISOString(),
            provider_kind: 'docker',
          },
        ],
      },
    });

    expect(staleReport.statusCode).toBe(200);
    expect(staleReport.json()).toEqual({accepted: 1, reservations_released: 0});

    const [reboundRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, reportedRunner.id));
    expect(reboundRunner).toMatchObject({
      workspaceId,
      reservationId: reboundReservationId,
      state: 'running',
      intendedReservationId: null,
    });

    const terminalReport = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/report',
      headers: {authorization: `Bearer ${workspaceToken}`},
      payload: {
        events: [
          {
            provider_runner_id: providerRunnerId,
            reservation_id: staleReservation.id,
            template_key: 'linux',
            labels: ['linux'],
            state: 'terminated',
            reported_at: new Date(firstReportAt.getTime() + 2_000).toISOString(),
            provider_kind: 'docker',
          },
        ],
      },
    });

    expect(terminalReport.statusCode).toBe(200);
    expect(terminalReport.json()).toEqual({accepted: 1, reservations_released: 1});

    const [staleReservationAfterTerminal] = await db()
      .select()
      .from(reservations)
      .where(eq(reservations.id, staleReservation.id));
    const [reboundReservationAfterTerminal] = await db()
      .select()
      .from(reservations)
      .where(eq(reservations.id, reboundReservationId));
    expect(staleReservationAfterTerminal).toMatchObject({
      id: staleReservation.id,
      count: 1,
    });
    expect(reboundReservationAfterTerminal).toBeUndefined();

    const repeatedTerminalReport = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-instances/report',
      headers: {authorization: `Bearer ${workspaceToken}`},
      payload: {
        events: [
          {
            provider_runner_id: providerRunnerId,
            reservation_id: staleReservation.id,
            template_key: 'linux',
            labels: ['linux'],
            state: 'terminated',
            reported_at: new Date(firstReportAt.getTime() + 3_000).toISOString(),
            provider_kind: 'docker',
          },
        ],
      },
    });

    expect(repeatedTerminalReport.statusCode).toBe(200);
    expect(repeatedTerminalReport.json()).toEqual({accepted: 1, reservations_released: 0});
  });

  async function enrollRunner(controlSessionToken: string): Promise<void> {
    const enrolled = await app.inject({
      method: 'POST',
      url: '/runner-control/enrollment',
      headers: {authorization: `Bearer ${controlSessionToken}`},
      payload: {labels: ['linux'], provider_kind: 'docker', protocol_version: '1'},
    });

    expect(enrolled.statusCode).toBe(200);
    expect(enrolled.json()).toEqual({activation_token: null});
  }
});
