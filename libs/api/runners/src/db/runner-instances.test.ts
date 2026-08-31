import {pgClient} from '@shipfox/node-postgres';
import {and, desc, eq, inArray, or, sql} from 'drizzle-orm';
import {reconcileRunnerInstances as reconcileRunnerInstancesCore} from '#core/runner-instances.js';
import {authorizeRunnerTermination} from '#core/termination-authorization.js';
import {db} from '#db/db.js';
import {reconcileTerminalJobExecution} from '#db/job-executions.js';
import {
  pollDemandAndReserve,
  releaseTerminalRunnerInstanceReservationsByIds,
} from '#db/reservations.js';
import {
  attachRunnerInstanceProviderId,
  countStaleEnrolledRunnerInstances,
  listActiveRunnerInstanceCountsByTemplateTx,
  listActiveRunnerInstances,
  listProviderRunnerByPhaseMetrics,
  listProviderRunnerByStateMetrics,
  listProvisionerTerminateIntentRowsTx,
  listProvisionerTerminateIntents,
  reapStaleRunnerInstances,
  reconcileRunnerInstances,
  reportRunnerInstances as reportRunnerInstancesDb,
} from '#db/runner-instances.js';
import {provisionerTokens} from '#db/schema/provisioner-tokens.js';
import {reservations} from '#db/schema/reservations.js';
import {runnerControlSessions} from '#db/schema/runner-control-sessions.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
import {runningJobExecutions} from '#db/schema/running-job-executions.js';
import {
  pendingJobFactory,
  providerRunnerFactory,
  provisionerTokenFactory,
  reservationFactory,
  runnerSessionFactory,
} from '#test/index.js';

type ReportRunnerInstancesTestParams = Parameters<typeof reportRunnerInstancesDb>[0];

function reportRunnerInstances(params: ReportRunnerInstancesTestParams) {
  return reportRunnerInstancesDb(params);
}

function providerRunnerRowsFor(params: {workspaceId: string; provisionerId: string}) {
  return db()
    .select()
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.workspaceId, params.workspaceId),
        eq(providerRunners.provisionerId, params.provisionerId),
      ),
    );
}

function reservationRowsFor(params: {workspaceId: string; provisionerId: string}) {
  return db()
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.workspaceId, params.workspaceId),
        eq(reservations.provisionerId, params.provisionerId),
      ),
    );
}

async function insertRunningJobRow(params: {
  workspaceId: string;
  provisionerId: string;
  providerRunnerId: string;
  jobExecutionId?: string;
  startedAt?: Date;
  cancellationRequestedAt?: Date | null;
}) {
  const startedAt = params.startedAt ?? new Date('2025-01-01T00:00:00.000Z');
  const runnerSession = await runnerSessionFactory.create({workspaceId: params.workspaceId});

  await db()
    .insert(runningJobExecutions)
    .values({
      workspaceId: params.workspaceId,
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      jobId: crypto.randomUUID(),
      jobExecutionId: params.jobExecutionId ?? crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      runnerSessionId: runnerSession.id,
      provisionerId: params.provisionerId,
      providerRunnerId: params.providerRunnerId,
      requiredLabels: ['linux'],
      runnerLabels: ['linux'],
      startedAt,
      lastHeartbeatAt: startedAt,
      cancellationRequestedAt: params.cancellationRequestedAt ?? null,
    });
}

describe('authorizeRunnerTermination', () => {
  it('keeps disabled and unknown reasons from authorizing termination', async () => {
    const runner = await providerRunnerFactory.create({
      workspaceId: crypto.randomUUID(),
      state: 'running',
    });

    const disabled = await authorizeRunnerTermination({
      provisionerId: runner.provisionerId,
      providerRunnerId: runner.providerRunnerId,
      reason: 'registration-deadline',
    });
    const unknown = await authorizeRunnerTermination({
      provisionerId: runner.provisionerId,
      providerRunnerId: runner.providerRunnerId,
      reason: 'not-a-reason',
    });

    expect(disabled.desiredIntent).toBe('keep');
    expect(unknown.desiredIntent).toBe('keep');
    expect(
      await db()
        .select({authorizedAt: providerRunners.terminationAuthorizedAt})
        .from(providerRunners)
        .where(eq(providerRunners.id, runner.id)),
    ).toEqual([{authorizedAt: null}]);
  });

  it('reuses an existing authorization and its first reason', async () => {
    const runner = await providerRunnerFactory.create({workspaceId: crypto.randomUUID()});
    const authorizedAt = new Date('2026-01-01T00:00:00.000Z');
    await db()
      .update(providerRunners)
      .set({terminationAuthorizedAt: authorizedAt, terminationReason: 'terminal-state'})
      .where(eq(providerRunners.id, runner.id));

    const result = await authorizeRunnerTermination({
      provisionerId: runner.provisionerId,
      providerRunnerId: runner.providerRunnerId,
      reason: 'job-timeout',
    });

    expect(result).toEqual({
      desiredIntent: 'terminate',
      terminationAuthorizedAt: authorizedAt,
      terminationReason: 'terminal-state',
    });
  });
});

describe('reportRunnerInstances', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
  });

  it('reports and reconciles installation capacity without a workspace assignment', async () => {
    const reportedAt = new Date();

    const report = await reportRunnerInstances({
      scope: 'installation',
      workspaceId: null,
      provisionerId,
      events: [event({providerRunnerId: 'installation-runner', reportedAt})],
    });
    const reconcile = await reconcileRunnerInstances({
      workspaceId: null,
      provisionerId,
      observedRunnerInstanceIds: ['installation-runner'],
      terminateGraceSeconds: 60,
    });
    const [row] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.providerRunnerId, 'installation-runner'));

    expect(report).toEqual({accepted: 1, reservationsReleased: 0, terminateIntentsHonored: []});
    expect(reconcile.absentIds).toEqual([]);
    expect(reconcile.observedRows).toMatchObject([{workspaceId: null}]);
    expect(row).toMatchObject({workspaceId: null, provisionerId, reportedAt});
  });

  it('dedupes duplicate provisioned runner ids in one batch', async () => {
    const reportedAt = new Date();

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({providerRunnerId: 'provisioned-runner-1', state: 'starting', reportedAt}),
        event({
          providerRunnerId: 'provisioned-runner-1',
          state: 'running',
          reportedAt: new Date(reportedAt.getTime() + 1),
        }),
      ],
    });

    const rows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 0, terminateIntentsHonored: []});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('running');
  });

  it('preserves launch kind when a provider report updates the runner row', async () => {
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'demand-runner',
      launchKind: 'demand',
    });

    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [event({providerRunnerId: 'demand-runner', state: 'running'})],
    });

    const [row] = await db()
      .select({launchKind: providerRunners.launchKind})
      .from(providerRunners)
      .where(eq(providerRunners.providerRunnerId, 'demand-runner'));
    expect(row?.launchKind).toBe('demand');
  });

  it('uses state progression to dedupe equal-timestamp provisioned runner reports', async () => {
    const reportedAt = new Date();

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({providerRunnerId: 'provisioned-runner-1', state: 'running', reportedAt}),
        event({providerRunnerId: 'provisioned-runner-1', state: 'failed', reportedAt}),
        event({providerRunnerId: 'provisioned-runner-2', state: 'failed', reportedAt}),
        event({providerRunnerId: 'provisioned-runner-2', state: 'running', reportedAt}),
      ],
    });

    const rows = await providerRunnerRowsFor({workspaceId, provisionerId}).orderBy(
      providerRunners.providerRunnerId,
    );
    expect(result).toEqual({accepted: 2, reservationsReleased: 0, terminateIntentsHonored: []});
    expect(rows.map((row) => row.state)).toEqual(['failed', 'failed']);
  });

  it('accepts delayed events that move the lifecycle forward', async () => {
    const newest = new Date();
    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({providerRunnerId: 'provisioned-runner-1', state: 'running', reportedAt: newest}),
      ],
    });

    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          state: 'failed',
          reason: 'late stale failure',
          reportedAt: new Date(newest.getTime() - 1_000),
        }),
      ],
    });

    const rows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(rows[0]?.state).toBe('failed');
    expect(rows[0]?.reason).toBe('late stale failure');
  });

  it('does not release a reservation for a terminal report older than the projection', async () => {
    const reservationId = await createReservation(1);
    const currentReportedAt = new Date('2025-01-01T00:01:00.000Z');
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'stale-terminal-runner',
      reservationId,
      state: 'running',
      reportedAt: currentReportedAt,
    });

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'stale-terminal-runner',
          reservationId,
          state: 'failed',
          reportedAt: new Date(currentReportedAt.getTime() - 1_000),
        }),
      ],
    });

    const [providerRunner] = await providerRunnerRowsFor({workspaceId, provisionerId});
    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 0, terminateIntentsHonored: []});
    expect(providerRunner).toMatchObject({state: 'failed', reservationReleasedAt: null});
    expect(reservation?.count).toBe(1);
  });

  it('rejects older out-of-order events in the same lifecycle state', async () => {
    const newest = new Date();
    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          state: 'running',
          reason: 'fresh',
          reportedAt: newest,
        }),
      ],
    });

    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          state: 'running',
          reason: 'stale',
          reportedAt: new Date(newest.getTime() - 1_000),
        }),
      ],
    });

    const rows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(rows[0]?.state).toBe('running');
    expect(rows[0]?.reason).toBe('fresh');
  });

  it('preserves a rebound reservation through stale reports and releases it on termination', async () => {
    const staleReservationId = await createReservation(1);
    await db()
      .update(reservations)
      .set({expiresAt: new Date(Date.now() - 60_000)})
      .where(eq(reservations.id, staleReservationId));
    const reboundReservationId = await createReservation(2);
    const initialReportedAt = new Date(Date.now() - 120_000);
    const runningReportedAt = new Date(Date.now() - 60_000);
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'rebound-runner',
      reservationId: reboundReservationId,
      state: 'running',
      reportedAt: initialReportedAt,
    });

    const runningReport = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'rebound-runner',
          reservationId: staleReservationId,
          reportedAt: runningReportedAt,
        }),
      ],
    });
    const terminalReport = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'rebound-runner',
          reservationId: staleReservationId,
          state: 'failed',
          reportedAt: new Date(runningReportedAt.getTime() + 1_000),
        }),
      ],
    });

    const [runner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.providerRunnerId, 'rebound-runner'));
    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    expect(runningReport).toEqual({
      accepted: 1,
      reservationsReleased: 0,
      terminateIntentsHonored: [],
    });
    expect(terminalReport).toEqual({
      accepted: 1,
      reservationsReleased: 1,
      terminateIntentsHonored: [],
    });
    expect(runner).toMatchObject({
      reservationId: reboundReservationId,
      reservationReleasedAt: expect.any(Date),
    });
    expect(
      reservationRows.find((reservation) => reservation.id === reboundReservationId)?.count,
    ).toBe(1);
    expect(
      reservationRows.find((reservation) => reservation.id === staleReservationId)?.count,
    ).toBe(1);
  });

  it('keeps the stored reservation when a report carries a stale reservation id', async () => {
    const staleReservationId = await createReservation(1);
    const boundReservationId = await createReservation(1);
    await db()
      .insert(providerRunners)
      .values({
        workspaceId,
        provisionerId,
        reservationId: boundReservationId,
        providerRunnerId: 'provisioned-runner-1',
        state: 'running',
        reportedAt: new Date('2025-01-01T00:00:00.000Z'),
      });

    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          reservationId: staleReservationId,
          state: 'running',
          reportedAt: new Date('2025-01-01T00:01:00.000Z'),
        }),
      ],
    });

    const rows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(rows[0]?.reservationId).toBe(boundReservationId);
  });

  it('adopts a reported reservation id when the runner carries none', async () => {
    const reservationId = await createReservation(1);
    await db()
      .insert(providerRunners)
      .values({
        workspaceId,
        provisionerId,
        providerRunnerId: 'provisioned-runner-1',
        state: 'starting',
        reportedAt: new Date('2025-01-01T00:00:00.000Z'),
      });

    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'running',
          reportedAt: new Date('2025-01-01T00:01:00.000Z'),
        }),
      ],
    });

    const rows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(rows[0]?.reservationId).toBe(reservationId);
  });

  it('does not adopt a bound reservation id from an unclaimed report', async () => {
    const reservationId = await createReservation(1, {kind: 'bound'});
    await db()
      .insert(providerRunners)
      .values({
        workspaceId,
        provisionerId,
        providerRunnerId: 'bound-reservation-runner',
        state: 'starting',
        reportedAt: new Date('2025-01-01T00:00:00.000Z'),
      });

    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'bound-reservation-runner',
          reservationId,
          state: 'running',
          reportedAt: new Date('2025-01-01T00:01:00.000Z'),
        }),
      ],
    });

    const rows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(rows[0]?.reservationId).toBeNull();
  });

  it('does not let reports exceed reservation capacity when creating projection rows', async () => {
    const reservationId = await createReservation(1);

    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({providerRunnerId: 'provisioned-runner-1', reservationId}),
        event({providerRunnerId: 'provisioned-runner-2', reservationId}),
      ],
    });

    const rows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(rows.find((row) => row.providerRunnerId === 'provisioned-runner-1')?.reservationId).toBe(
      reservationId,
    );
    expect(
      rows.find((row) => row.providerRunnerId === 'provisioned-runner-2')?.reservationId,
    ).toBeNull();
  });

  it('does not let equal-timestamp lower-priority reports flip terminal state', async () => {
    const reservationId = await createReservation(1);
    const reportedAt = new Date('2025-01-01T00:00:00.000Z');
    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'running',
          reportedAt,
        }),
      ],
    });

    const terminal = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'failed',
          reportedAt,
        }),
      ],
    });
    const revived = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'running',
          reportedAt,
        }),
      ],
    });

    const providerRunnerRows = await providerRunnerRowsFor({workspaceId, provisionerId});
    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    expect(terminal).toEqual({accepted: 1, reservationsReleased: 1, terminateIntentsHonored: []});
    expect(revived).toEqual({accepted: 1, reservationsReleased: 0, terminateIntentsHonored: []});
    expect(providerRunnerRows[0]?.state).toBe('failed');
    expect(providerRunnerRows[0]?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(reservationRows).toHaveLength(0);
  });

  it('clamps future reported times so they do not pin provisioned runner state', async () => {
    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          state: 'starting',
          reportedAt: new Date(Date.now() + 60 * 60 * 1000),
        }),
      ],
    });

    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          state: 'running',
          reportedAt: new Date(),
        }),
      ],
    });

    const rows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(rows[0]?.state).toBe('running');
    expect(rows[0]?.reportedAt.getTime()).toBeLessThan(Date.now() + 10_000);
  });

  it('records lifecycle milestone timestamps from one report batch', async () => {
    const startedAt = new Date('2025-01-01T00:00:00.000Z');
    const stoppingAt = new Date('2025-01-01T00:01:00.000Z');
    const stoppedAt = new Date('2025-01-01T00:02:00.000Z');
    const terminatedAt = new Date('2025-01-01T00:03:00.000Z');

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          state: 'running',
          reportedAt: startedAt,
        }),
        event({
          providerRunnerId: 'provisioned-runner-1',
          state: 'stopping',
          reportedAt: stoppingAt,
        }),
        event({
          providerRunnerId: 'provisioned-runner-1',
          state: 'stopped',
          reportedAt: stoppedAt,
        }),
        event({
          providerRunnerId: 'provisioned-runner-1',
          state: 'terminated',
          reportedAt: terminatedAt,
        }),
      ],
    });

    const rows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 0, terminateIntentsHonored: []});
    expect(rows[0]?.state).toBe('terminated');
    expect(rows[0]?.reportedAt.toISOString()).toBe(terminatedAt.toISOString());
    expect(rows[0]?.startedAt?.toISOString()).toBe(startedAt.toISOString());
    expect(rows[0]?.stoppingAt?.toISOString()).toBe(stoppingAt.toISOString());
    expect(rows[0]?.stoppedAt?.toISOString()).toBe(stoppedAt.toISOString());
    expect(rows[0]?.failedAt).toBeNull();
    expect(rows[0]?.terminatedAt?.toISOString()).toBe(terminatedAt.toISOString());
  });

  it('records delayed lower-state milestones without reviving current state', async () => {
    const terminatedAt = new Date('2025-01-01T00:03:00.000Z');
    const startedAt = new Date('2025-01-01T00:00:00.000Z');
    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          state: 'terminated',
          reportedAt: terminatedAt,
        }),
      ],
    });

    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          state: 'running',
          reportedAt: startedAt,
        }),
      ],
    });

    const rows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(rows[0]?.state).toBe('terminated');
    expect(rows[0]?.reportedAt.toISOString()).toBe(terminatedAt.toISOString());
    expect(rows[0]?.startedAt?.toISOString()).toBe(startedAt.toISOString());
    expect(rows[0]?.terminatedAt?.toISOString()).toBe(terminatedAt.toISOString());
  });

  it('uses server update time for active provisioned runner windows', async () => {
    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          state: 'running',
          reportedAt: new Date(Date.now() + 60 * 60 * 1000),
        }),
      ],
    });
    await db().execute(
      sql`UPDATE runners_runner_instances SET updated_at = now() - interval '10 minutes'`,
    );

    const active = await listActiveRunnerInstances({workspaceId, windowSeconds: 60});

    expect(active).toEqual([]);
  });

  it('releases one reservation unit for a terminal runner with an intended reservation', async () => {
    const reservationId = await createReservation(2);
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      intendedReservationId: reservationId,
      state: 'running',
    });

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [event({providerRunnerId: 'provisioned-runner-1', reservationId, state: 'failed'})],
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    const providerRunnerRows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 1, terminateIntentsHonored: []});
    expect(reservationRows[0]?.count).toBe(1);
    expect(providerRunnerRows[0]?.reservationReleasedAt).toBeInstanceOf(Date);
  });

  it('does not let an unrecognized terminal report consume reservation capacity', async () => {
    const reservationId = await createReservation(1);

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [event({providerRunnerId: 'unrecognized-runner', reservationId, state: 'failed'})],
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    const providerRunnerRows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 0, terminateIntentsHonored: []});
    expect(reservationRows[0]?.count).toBe(1);
    expect(providerRunnerRows).toHaveLength(1);
    expect(providerRunnerRows[0]).toMatchObject({
      providerRunnerId: 'unrecognized-runner',
      reservationId: null,
      intendedReservationId: null,
      reservationReleasedAt: null,
      state: 'failed',
    });
  });

  it('releases an intended reservation for a runner that dies before enrollment', async () => {
    const reservationId = await createReservation(2);
    const [runner] = await db()
      .insert(providerRunners)
      .values({
        provisionerId,
        intendedReservationId: reservationId,
        providerRunnerId: 'pre-enrollment-runner',
        state: 'starting',
        reportedAt: new Date(),
      })
      .returning();
    if (!runner) throw new Error('Runner instance insert returned no row');
    if (!runner.providerRunnerId) throw new Error('Runner instance provider id missing');

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [event({providerRunnerId: runner.providerRunnerId, state: 'failed'})],
    });

    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 1, terminateIntentsHonored: []});
    expect(reservationRows[0]?.count).toBe(1);
    expect(storedRunner?.intendedReservationId).toBeNull();
    expect(storedRunner?.reservationReleasedAt).toBeInstanceOf(Date);
  });

  it('releases an intended reservation from an installation-scoped terminal report', async () => {
    const installationProvisioner = await provisionerTokenFactory.create({
      scope: 'installation',
      workspaceId: null,
    });
    const reservationWorkspaceId = crypto.randomUUID();
    await reservationFactory.create({
      workspaceId: reservationWorkspaceId,
      provisionerId: installationProvisioner.id,
      requiredLabels: ['linux'],
      count: 2,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [reservation] = await db()
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.workspaceId, reservationWorkspaceId),
          eq(reservations.provisionerId, installationProvisioner.id),
        ),
      )
      .orderBy(desc(reservations.id))
      .limit(1);
    if (!reservation) throw new Error('Expected reservation');
    await db().insert(providerRunners).values({
      provisionerId: installationProvisioner.id,
      intendedReservationId: reservation.id,
      providerRunnerId: 'installation-pre-enrollment-runner',
      state: 'starting',
      reportedAt: new Date(),
    });

    const result = await reportRunnerInstances({
      scope: 'installation',
      workspaceId: null,
      provisionerId: installationProvisioner.id,
      events: [event({providerRunnerId: 'installation-pre-enrollment-runner', state: 'failed'})],
    });

    const [storedReservation] = await db()
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservation.id));
    const [storedRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.providerRunnerId, 'installation-pre-enrollment-runner'));
    expect(result).toEqual({accepted: 1, reservationsReleased: 1, terminateIntentsHonored: []});
    expect(storedReservation?.count).toBe(1);
    expect(storedRunner?.intendedReservationId).toBeNull();
    expect(storedRunner?.reservationReleasedAt).toBeInstanceOf(Date);
  });

  it('prefers the validated intended reservation when both reservation ids are set', async () => {
    const installationProvisioner = await provisionerTokenFactory.create({
      scope: 'installation',
      workspaceId: null,
    });
    const staleReservationId = await createReservation(1, {
      workspaceId: crypto.randomUUID(),
      provisionerId: installationProvisioner.id,
    });
    const intendedReservationId = await createReservation(1, {
      workspaceId: crypto.randomUUID(),
      provisionerId: installationProvisioner.id,
    });
    await db().insert(providerRunners).values({
      provisionerId: installationProvisioner.id,
      reservationId: staleReservationId,
      intendedReservationId,
      providerRunnerId: 'installation-runner-with-stale-reservation',
      state: 'starting',
      reportedAt: new Date(),
    });

    const result = await reportRunnerInstances({
      scope: 'installation',
      workspaceId: null,
      provisionerId: installationProvisioner.id,
      events: [
        event({providerRunnerId: 'installation-runner-with-stale-reservation', state: 'failed'}),
      ],
    });

    const [staleReservation] = await db()
      .select()
      .from(reservations)
      .where(eq(reservations.id, staleReservationId));
    const [intendedReservation] = await db()
      .select()
      .from(reservations)
      .where(eq(reservations.id, intendedReservationId));
    expect(result).toEqual({accepted: 1, reservationsReleased: 1, terminateIntentsHonored: []});
    expect(staleReservation?.count).toBe(1);
    expect(intendedReservation).toBeUndefined();
  });

  it('does not release a reservation owned by another workspace or provisioner', async () => {
    const otherWorkspaceReservationId = await createReservation(1, {
      workspaceId: crypto.randomUUID(),
      provisionerId,
    });
    const peerProvisionerReservationId = await createReservation(1, {
      workspaceId,
      provisionerId: crypto.randomUUID(),
    });

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          reservationId: otherWorkspaceReservationId,
          state: 'failed',
        }),
        event({
          providerRunnerId: 'provisioned-runner-2',
          reservationId: peerProvisionerReservationId,
          state: 'failed',
        }),
      ],
    });

    const reservationRows = await db()
      .select()
      .from(reservations)
      .where(inArray(reservations.id, [otherWorkspaceReservationId, peerProvisionerReservationId]));
    expect(result).toEqual({accepted: 2, reservationsReleased: 0, terminateIntentsHonored: []});
    expect(reservationRows).toHaveLength(2);
    expect(reservationRows.every((reservation) => reservation.count === 1)).toBe(true);
  });

  it('releases a reservation only once across repeated terminal reports', async () => {
    const reservationId = await createReservation(2);
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      intendedReservationId: reservationId,
      state: 'running',
    });

    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [event({providerRunnerId: 'provisioned-runner-1', reservationId, state: 'failed'})],
    });
    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [event({providerRunnerId: 'provisioned-runner-1', reservationId, state: 'failed'})],
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 0, terminateIntentsHonored: []});
    expect(reservationRows[0]?.count).toBe(1);
  });

  it('does not let a newer running report revive a terminal provisioned runner', async () => {
    const reservationId = await createReservation(2);
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      intendedReservationId: reservationId,
      state: 'running',
    });
    const failedAt = new Date();
    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'failed',
          reportedAt: failedAt,
        }),
      ],
    });

    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'running',
          reportedAt: new Date(failedAt.getTime() + 1_000),
        }),
      ],
    });

    const providerRunnerRows = await providerRunnerRowsFor({workspaceId, provisionerId});
    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    expect(providerRunnerRows[0]?.state).toBe('failed');
    expect(providerRunnerRows[0]?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(reservationRows[0]?.count).toBe(1);
  });

  it('tracks provider cleanup as terminated', async () => {
    const reservationId = await createReservation(2);
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      intendedReservationId: reservationId,
      state: 'running',
    });

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({providerRunnerId: 'provisioned-runner-1', reservationId, state: 'terminated'}),
      ],
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    const providerRunnerRows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 1, terminateIntentsHonored: []});
    expect(reservationRows[0]?.count).toBe(1);
    expect(providerRunnerRows[0]?.state).toBe('terminated');
    expect(providerRunnerRows[0]?.terminatedAt).toBeInstanceOf(Date);
    expect(providerRunnerRows[0]?.reservationReleasedAt).toBeInstanceOf(Date);
  });

  it('releases multiple units from the same reservation in one batch', async () => {
    const reservationId = await createReservation(3);
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      intendedReservationId: reservationId,
      state: 'running',
    });
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-2',
      intendedReservationId: reservationId,
      state: 'running',
    });

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({providerRunnerId: 'provisioned-runner-1', reservationId, state: 'failed'}),
        event({providerRunnerId: 'provisioned-runner-2', reservationId, state: 'stopped'}),
      ],
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 2, reservationsReleased: 2, terminateIntentsHonored: []});
    expect(reservationRows[0]?.count).toBe(1);
  });

  it('deletes a one-unit reservation instead of violating the positive count check', async () => {
    const reservationId = await createReservation(1);
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      intendedReservationId: reservationId,
      state: 'running',
    });

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [event({providerRunnerId: 'provisioned-runner-1', reservationId, state: 'failed'})],
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 1, terminateIntentsHonored: []});
    expect(reservationRows).toHaveLength(0);
  });

  it('flags release without retrying when the reservation is already expired', async () => {
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    if (!reservation) throw new Error('Expected reservation');
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      intendedReservationId: reservation.id,
      state: 'running',
    });

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          reservationId: reservation.id,
          state: 'failed',
        }),
      ],
    });

    const providerRunnerRows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 0, terminateIntentsHonored: []});
    expect(providerRunnerRows[0]?.reservationReleasedAt).toBeInstanceOf(Date);
  });

  it('releases a reservation for a provisioned runner that already has a runner session', async () => {
    const reservationId = await createReservation(1);
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      reservationId,
      state: 'running',
    });

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'failed',
          runnerSessionId: runnerSession.id,
        }),
      ],
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    const providerRunnerRows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 1, terminateIntentsHonored: []});
    expect(reservationRows).toHaveLength(0);
    expect(providerRunnerRows[0]?.runnerSessionId).toBe(runnerSession.id);
    expect(providerRunnerRows[0]?.reservationReleasedAt).toBeInstanceOf(Date);
  });

  it('keeps a reservation while a terminal runner still has a running job', async () => {
    const reservationId = await createReservation(1);
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'busy-terminal-runner',
      reservationId,
      runnerSessionId: runnerSession.id,
      state: 'running',
    });
    await insertRunningJobRow({
      workspaceId,
      provisionerId,
      providerRunnerId: 'busy-terminal-runner',
    });

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'busy-terminal-runner',
          reservationId,
          state: 'failed',
          runnerSessionId: runnerSession.id,
        }),
      ],
    });

    const [providerRunner] = await providerRunnerRowsFor({workspaceId, provisionerId});
    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 0, terminateIntentsHonored: []});
    expect(providerRunner).toMatchObject({state: 'failed', reservationReleasedAt: null});
    expect(reservation?.count).toBe(1);
  });

  it('keeps a reservation when a terminal runner has cancelled and uncancelled jobs', async () => {
    const reservationId = await createReservation(1);
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'mixed-terminal-runner',
      reservationId,
      runnerSessionId: runnerSession.id,
      state: 'running',
    });
    await insertRunningJobRow({
      workspaceId,
      provisionerId,
      providerRunnerId: 'mixed-terminal-runner',
      startedAt: new Date('2025-01-01T00:00:00.000Z'),
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });
    await insertRunningJobRow({
      workspaceId,
      provisionerId,
      providerRunnerId: 'mixed-terminal-runner',
      startedAt: new Date('2025-01-01T00:02:00.000Z'),
    });

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'mixed-terminal-runner',
          reservationId,
          state: 'terminated',
          runnerSessionId: runnerSession.id,
        }),
      ],
    });

    const [providerRunner] = await providerRunnerRowsFor({workspaceId, provisionerId});
    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 0, terminateIntentsHonored: []});
    expect(providerRunner).toMatchObject({state: 'terminated', reservationReleasedAt: null});
    expect(reservation?.count).toBe(1);
  });

  it('releases a reservation when a terminal runner only has a cancelled job', async () => {
    const reservationId = await createReservation(1);
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'cancelled-terminal-runner',
      reservationId,
      runnerSessionId: runnerSession.id,
      state: 'running',
    });
    await insertRunningJobRow({
      workspaceId,
      provisionerId,
      providerRunnerId: 'cancelled-terminal-runner',
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'cancelled-terminal-runner',
          reservationId,
          state: 'terminated',
          runnerSessionId: runnerSession.id,
        }),
      ],
    });

    const [providerRunner] = await providerRunnerRowsFor({workspaceId, provisionerId});
    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    const runningJobRows = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.providerRunnerId, 'cancelled-terminal-runner'));
    expect(result).toEqual({
      accepted: 1,
      reservationsReleased: 1,
      terminateIntentsHonored: [
        {
          providerRunnerId: 'cancelled-terminal-runner',
          reason: 'job-cancelled',
          origin: 'legacy',
        },
      ],
    });
    expect(providerRunner).toMatchObject({
      state: 'terminated',
      reservationReleasedAt: expect.any(Date),
    });
    expect(reservationRows).toHaveLength(0);
    expect(runningJobRows).toHaveLength(1);
    expect(runningJobRows[0]?.cancellationRequestedAt).toBeInstanceOf(Date);
  });

  it('preserves claimed runner session metadata when a terminal state wins the batch', async () => {
    const reservationId = await createReservation(1);
    const runnerSessionId = crypto.randomUUID();
    const reportedAt = new Date('2025-01-01T00:00:00.000Z');
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      reservationId,
      state: 'running',
      reportedAt: new Date(reportedAt.getTime() - 1_000),
    });

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'running',
          runnerSessionId,
          reportedAt,
        }),
        event({
          providerRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'failed',
          reportedAt: new Date(reportedAt.getTime() + 1_000),
        }),
      ],
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    const providerRunnerRows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({accepted: 1, reservationsReleased: 1, terminateIntentsHonored: []});
    expect(reservationRows).toHaveLength(0);
    expect(providerRunnerRows[0]?.state).toBe('failed');
    expect(providerRunnerRows[0]?.runnerSessionId).toBe(runnerSessionId);
    expect(providerRunnerRows[0]?.reservationReleasedAt).toBeInstanceOf(Date);
  });

  it('returns the durable authorization reason for a terminal runner report once', async () => {
    const runner = await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'authorized-runner',
      state: 'terminated',
    });
    await db()
      .update(providerRunners)
      .set({terminationAuthorizedAt: new Date(), terminationReason: 'terminal-state'})
      .where(eq(providerRunners.id, runner.id));

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [event({providerRunnerId: 'authorized-runner', state: 'terminated'})],
    });
    const duplicate = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [event({providerRunnerId: 'authorized-runner', state: 'terminated'})],
    });

    expect(result.terminateIntentsHonored).toEqual([
      {providerRunnerId: 'authorized-runner', reason: 'terminal-state', origin: 'durable'},
    ]);
    expect(duplicate.terminateIntentsHonored).toEqual([]);
  });

  it('honors durable authorization for an installation-scoped runner', async () => {
    const runner = await providerRunnerFactory.create({
      workspaceId: null,
      provisionerId,
      providerRunnerId: 'installation-authorized-runner',
      state: 'terminated',
    });
    await db()
      .update(providerRunners)
      .set({terminationAuthorizedAt: new Date(), terminationReason: 'terminal-state'})
      .where(eq(providerRunners.id, runner.id));

    const result = await reportRunnerInstances({
      scope: 'installation',
      workspaceId: null,
      provisionerId,
      events: [event({providerRunnerId: 'installation-authorized-runner', state: 'terminated'})],
    });

    expect(result.terminateIntentsHonored).toEqual([
      {
        providerRunnerId: 'installation-authorized-runner',
        reason: 'terminal-state',
        origin: 'durable',
      },
    ]);
  });

  it('prefers a durable authorization over a legacy cancellation intent', async () => {
    const runner = await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'durable-and-legacy-runner',
      state: 'running',
    });
    await insertRunningJobRow({
      workspaceId,
      provisionerId,
      providerRunnerId: runner.providerRunnerId,
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });
    await db()
      .update(providerRunners)
      .set({terminationAuthorizedAt: new Date(), terminationReason: 'terminal-state'})
      .where(eq(providerRunners.id, runner.id));

    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [event({providerRunnerId: runner.providerRunnerId, state: 'terminated'})],
    });

    expect(result.terminateIntentsHonored).toEqual([
      {
        providerRunnerId: runner.providerRunnerId,
        reason: 'terminal-state',
        origin: 'durable',
      },
    ]);
  });

  it('honors a durable authorization after an intermediate terminal report', async () => {
    const authorizedAt = new Date(Date.now() - 2_000);
    const stoppedAt = new Date(authorizedAt.getTime() + 500);
    const terminatedAt = new Date(stoppedAt.getTime() + 500);
    const runner = await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'stopped-before-terminated-runner',
      state: 'running',
      reportedAt: new Date(authorizedAt.getTime() - 500),
    });
    await db()
      .update(providerRunners)
      .set({terminationAuthorizedAt: authorizedAt, terminationReason: 'terminal-state'})
      .where(eq(providerRunners.id, runner.id));

    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: runner.providerRunnerId,
          state: 'stopped',
          reportedAt: stoppedAt,
        }),
      ],
    });
    const result = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: runner.providerRunnerId,
          state: 'terminated',
          reportedAt: terminatedAt,
        }),
      ],
    });

    expect(result.terminateIntentsHonored).toEqual([
      {
        providerRunnerId: runner.providerRunnerId,
        reason: 'terminal-state',
        origin: 'durable',
      },
    ]);
  });

  it('returns honored terminate intents only for the first active-to-terminated transition', async () => {
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      state: 'running',
    });
    await insertRunningJobRow({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });

    const first = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [event({providerRunnerId: 'provisioned-runner-1', state: 'terminated'})],
    });
    const second = await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [event({providerRunnerId: 'provisioned-runner-1', state: 'terminated'})],
    });

    expect(first.terminateIntentsHonored).toEqual([
      {providerRunnerId: 'provisioned-runner-1', reason: 'job-cancelled', origin: 'legacy'},
    ]);
    expect(second.terminateIntentsHonored).toEqual([]);
  });

  async function createReservation(
    count: number,
    overrides?: {kind?: 'bound' | 'launch'; workspaceId?: string; provisionerId?: string},
  ): Promise<string> {
    await reservationFactory.create({
      workspaceId: overrides?.workspaceId ?? workspaceId,
      provisionerId: overrides?.provisionerId ?? provisionerId,
      requiredLabels: ['linux'],
      count,
      kind: overrides?.kind ?? 'launch',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [reservation] = await db()
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.workspaceId, overrides?.workspaceId ?? workspaceId),
          eq(reservations.provisionerId, overrides?.provisionerId ?? provisionerId),
        ),
      )
      .orderBy(desc(reservations.id))
      .limit(1);
    if (!reservation) throw new Error('Expected reservation');
    return reservation.id;
  }

  function event(params: {
    providerRunnerId?: string;
    reservationId?: string | null;
    state?: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'terminated';
    reportedAt?: Date;
    reason?: string | null;
    runnerSessionId?: string | null;
  }) {
    return {
      providerRunnerId: params.providerRunnerId ?? 'provisioned-runner-1',
      reservationId: params.reservationId ?? null,
      templateKey: 'linux',
      labels: ['linux'],
      state: params.state ?? 'running',
      reason: params.reason ?? null,
      runnerSessionId: params.runnerSessionId ?? null,
      providerKind: 'docker',
      reportedAt: params.reportedAt ?? new Date(),
    };
  }
});

describe('listActiveRunnerInstanceCountsByTemplateTx', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
  });

  it('groups starting and running provisioned runners by template and ignores non-divergence states', async () => {
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'starting-1',
      templateKey: 'linux',
      state: 'starting',
    });
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'running-1',
      templateKey: 'linux',
      state: 'running',
    });
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'running-2',
      templateKey: 'linux',
      state: 'running',
    });
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'stopping-1',
      templateKey: 'linux',
      state: 'stopping',
    });
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: 'null-template',
      templateKey: null,
      state: 'running',
    });

    const result = await db().transaction((tx) =>
      listActiveRunnerInstanceCountsByTemplateTx(tx, {workspaceId, provisionerId}),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        {templateKey: 'linux', state: 'starting', count: 1},
        {templateKey: 'linux', state: 'running', count: 2},
      ]),
    );
    expect(result).toHaveLength(2);
  });
});

describe('listProvisionerTerminateIntents', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
  });

  it('includes active provisioned runners whose latest bound job is cancelled', async () => {
    await createRunnerInstance({providerRunnerId: 'provisioned-runner-1'});
    await insertRunningJobRow({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });

    const result = await listProvisionerTerminateIntents({workspaceId, provisionerId, limit: 1000});

    expect(result).toEqual(['provisioned-runner-1']);
  });

  it('returns structured rows with bounded reasons from the shared query', async () => {
    await createRunnerInstance({providerRunnerId: 'provisioned-runner-1'});
    await insertRunningJobRow({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });

    const result = await db().transaction((tx) =>
      listProvisionerTerminateIntentRowsTx(tx, {workspaceId, provisionerId, limit: 1000}),
    );

    expect(result).toEqual([{providerRunnerId: 'provisioned-runner-1', reason: 'job-cancelled'}]);
  });

  it('returns an activation-timeout intent for a stale demand-backed runner', async () => {
    await createRunnerInstance({
      providerRunnerId: 'stale-demand-runner',
      launchKind: 'demand',
      createdAt: new Date(Date.now() - 301_000),
    });

    const result = await db().transaction((tx) =>
      listProvisionerTerminateIntentRowsTx(tx, {workspaceId, provisionerId, limit: 1000}),
    );
    const [runner] = await providerRunnerRowsFor({workspaceId, provisionerId});

    expect(result).toEqual([
      {providerRunnerId: 'stale-demand-runner', reason: 'activation-timeout'},
    ]);
    expect(runner?.reservationReleasedAt).toBeInstanceOf(Date);
  });

  it('does not reclaim warm, manual, active, or already-activated runners', async () => {
    const [liveReservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: ['linux'],
        count: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning({id: reservations.id});
    if (!liveReservation) throw new Error('Expected live reservation');

    const staleCreatedAt = new Date(Date.now() - 301_000);
    await createRunnerInstance({
      providerRunnerId: 'stale-warm-runner',
      launchKind: 'warm',
      createdAt: staleCreatedAt,
    });
    await createRunnerInstance({
      providerRunnerId: 'stale-manual-runner',
      launchKind: 'manual',
      createdAt: staleCreatedAt,
    });
    await createRunnerInstance({
      providerRunnerId: 'live-demand-runner',
      launchKind: 'demand',
      reservationId: liveReservation.id,
      createdAt: staleCreatedAt,
    });
    await db()
      .insert(providerRunners)
      .values({
        workspaceId,
        provisionerId,
        intendedReservationId: liveReservation.id,
        providerRunnerId: 'live-intended-demand-runner',
        launchKind: 'demand',
        state: 'running',
        labels: ['linux'],
        reportedAt: staleCreatedAt,
        createdAt: staleCreatedAt,
        updatedAt: staleCreatedAt,
      });
    await createRunnerInstance({
      providerRunnerId: 'activated-demand-runner',
      launchKind: 'demand',
      runnerSessionId: crypto.randomUUID(),
      createdAt: staleCreatedAt,
    });

    const result = await listProvisionerTerminateIntents({workspaceId, provisionerId, limit: 1000});

    expect(result).toEqual([]);
  });

  it('marks activation-timeout retries after releasing the runner reservation', async () => {
    await createRunnerInstance({
      providerRunnerId: 'retryable-demand-runner',
      launchKind: 'demand',
      createdAt: new Date(Date.now() - 301_000),
    });

    const first = await db().transaction((tx) =>
      listProvisionerTerminateIntentRowsTx(tx, {workspaceId, provisionerId, limit: 1000}),
    );
    const second = await db().transaction((tx) =>
      listProvisionerTerminateIntentRowsTx(tx, {workspaceId, provisionerId, limit: 1000}),
    );

    expect(first).toEqual([
      {providerRunnerId: 'retryable-demand-runner', reason: 'activation-timeout'},
    ]);
    expect(second).toEqual([
      {
        providerRunnerId: 'retryable-demand-runner',
        reason: 'activation-timeout',
        activationTimeoutRetry: true,
      },
    ]);
  });

  it('excludes active provisioned runners whose latest bound job is healthy', async () => {
    await createRunnerInstance({providerRunnerId: 'provisioned-runner-1'});
    await insertRunningJobRow({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
    });

    const result = await listProvisionerTerminateIntents({workspaceId, provisionerId, limit: 1000});

    expect(result).toEqual([]);
  });

  it('excludes terminal provisioned runners with cancelled bound jobs', async () => {
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-1',
      state: 'terminated',
    });
    await insertRunningJobRow({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });

    const result = await listProvisionerTerminateIntents({workspaceId, provisionerId, limit: 1000});

    expect(result).toEqual([]);
  });

  it('excludes a cancelled job when it is not the latest bound job', async () => {
    await createRunnerInstance({providerRunnerId: 'provisioned-runner-1'});
    await insertRunningJobRow({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      startedAt: new Date('2025-01-01T00:00:00.000Z'),
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });
    await insertRunningJobRow({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      startedAt: new Date('2025-01-01T00:02:00.000Z'),
    });

    const result = await listProvisionerTerminateIntents({workspaceId, provisionerId, limit: 1000});

    expect(result).toEqual([]);
  });

  it('excludes cancelled jobs for another provisioner', async () => {
    const otherProvisionerId = crypto.randomUUID();
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-1',
      provisionerId: otherProvisionerId,
    });
    await insertRunningJobRow({
      workspaceId,
      providerRunnerId: 'provisioned-runner-1',
      provisionerId: otherProvisionerId,
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });

    const result = await listProvisionerTerminateIntents({workspaceId, provisionerId, limit: 1000});

    expect(result).toEqual([]);
  });

  it('returns one id for duplicate cancelled bound jobs on the same provisioned runner', async () => {
    await createRunnerInstance({providerRunnerId: 'provisioned-runner-1'});
    await insertRunningJobRow({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      startedAt: new Date('2025-01-01T00:00:00.000Z'),
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });
    await insertRunningJobRow({
      workspaceId,
      provisionerId,
      providerRunnerId: 'provisioned-runner-1',
      startedAt: new Date('2025-01-01T00:00:00.000Z'),
      cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
    });

    const result = await listProvisionerTerminateIntents({workspaceId, provisionerId, limit: 1000});

    expect(result).toEqual(['provisioned-runner-1']);
  });

  it('returns a deterministic subset when the limit truncates results', async () => {
    for (const providerRunnerId of [
      'provisioned-runner-c',
      'provisioned-runner-a',
      'provisioned-runner-b',
    ]) {
      await createRunnerInstance({providerRunnerId});
      await insertRunningJobRow({
        workspaceId,
        provisionerId,
        providerRunnerId,
        cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
      });
    }

    const result = await listProvisionerTerminateIntents({workspaceId, provisionerId, limit: 2});

    expect(result).toEqual(['provisioned-runner-a', 'provisioned-runner-b']);
  });

  it('fills the limit with later authorized intents when earlier candidates are rejected', async () => {
    for (const providerRunnerId of [
      'provisioned-runner-a',
      'provisioned-runner-b',
      'provisioned-runner-c',
    ]) {
      await createRunnerInstance({providerRunnerId});
      await insertRunningJobRow({
        workspaceId,
        provisionerId,
        providerRunnerId,
        cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
      });
    }

    const authorizedProviderRunnerIds: string[] = [];
    const result = await db().transaction((tx) =>
      listProvisionerTerminateIntentRowsTx(
        tx,
        {workspaceId, provisionerId, limit: 2},
        {
          authorize: ({providerRunnerId}) => {
            authorizedProviderRunnerIds.push(providerRunnerId);
            return Promise.resolve(providerRunnerId !== 'provisioned-runner-a');
          },
        },
      ),
    );

    expect(result).toEqual([
      {providerRunnerId: 'provisioned-runner-b', reason: 'job-cancelled'},
      {providerRunnerId: 'provisioned-runner-c', reason: 'job-cancelled'},
    ]);
    expect(authorizedProviderRunnerIds).toEqual([
      'provisioned-runner-a',
      'provisioned-runner-b',
      'provisioned-runner-c',
    ]);
  });

  async function createRunnerInstance(params: {
    providerRunnerId: string;
    provisionerId?: string;
    state?: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'terminated';
    launchKind?: 'demand' | 'warm' | 'manual';
    createdAt?: Date;
    reservationId?: string | null;
    runnerSessionId?: string | null;
  }) {
    return await providerRunnerFactory.create({
      workspaceId,
      provisionerId: params.provisionerId ?? provisionerId,
      providerRunnerId: params.providerRunnerId,
      state: params.state ?? 'running',
      launchKind: params.launchKind ?? 'manual',
      createdAt: params.createdAt ?? new Date(),
      reservationId: params.reservationId ?? null,
      runnerSessionId: params.runnerSessionId ?? null,
    });
  }
});

describe('reapStaleRunnerInstances', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const provisioner = await provisionerTokenFactory.create({workspaceId});
    provisionerId = provisioner.id;
  });

  it('fails stale unclaimed provisioned runners and releases reservations', async () => {
    const reservationId = await createReservation(2);
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-1',
      reservationId,
      reportedAt: staleAt(),
      updatedAt: staleAt(),
    });

    const result = await reapStaleRunnerInstances({thresholdSeconds: 60, limit: 100});

    const [providerRunner] = await providerRunnerRowsFor({workspaceId, provisionerId});
    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({reaped: 1, reservationsReleased: 1});
    expect(providerRunner).toMatchObject({
      state: 'failed',
      reason: 'stale-provisioner',
    });
    expect(providerRunner?.failedAt).toBeInstanceOf(Date);
    expect(providerRunner?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(reservation?.id).toBe(reservationId);
    expect(reservation?.count).toBe(1);
  });

  it('fails a stale installation runner instance before provider attachment', async () => {
    const installationProvisioner = await provisionerTokenFactory.create({
      scope: 'installation',
      workspaceId: null,
    });
    await db()
      .update(provisionerTokens)
      .set({lastSeenAt: null})
      .where(eq(provisionerTokens.id, installationProvisioner.id));
    const [instance] = await db()
      .insert(providerRunners)
      .values({
        provisionerId: installationProvisioner.id,
        providerKind: 'docker',
        labels: [],
        state: 'starting',
        reportedAt: staleAt(),
        updatedAt: staleAt(),
      })
      .returning({id: providerRunners.id});
    if (!instance) throw new Error('Runner instance insert returned no row');

    const result = await reapStaleRunnerInstances({thresholdSeconds: 60, limit: 100});
    const [row] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, instance.id));

    expect(result.reaped).toBe(1);
    expect(row).toMatchObject({workspaceId: null, providerRunnerId: null, state: 'failed'});
  });

  it('releases an intended reservation while reaping a stale installation runner', async () => {
    const installationProvisioner = await provisionerTokenFactory.create({
      scope: 'installation',
      workspaceId: null,
    });
    const reservationWorkspaceId = crypto.randomUUID();
    await reservationFactory.create({
      workspaceId: reservationWorkspaceId,
      provisionerId: installationProvisioner.id,
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [reservation] = await db()
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.workspaceId, reservationWorkspaceId),
          eq(reservations.provisionerId, installationProvisioner.id),
        ),
      )
      .orderBy(desc(reservations.id))
      .limit(1);
    if (!reservation) throw new Error('Expected reservation');
    const [instance] = await db()
      .insert(providerRunners)
      .values({
        provisionerId: installationProvisioner.id,
        intendedReservationId: reservation.id,
        state: 'starting',
        reportedAt: staleAt(),
        updatedAt: staleAt(),
      })
      .returning({id: providerRunners.id});
    if (!instance) throw new Error('Runner instance insert returned no row');

    const result = await reapStaleRunnerInstances({thresholdSeconds: 60, limit: 100});
    const [row] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, instance.id));
    const remainingReservations = await db()
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservation.id));

    expect(result).toEqual({reaped: 1, reservationsReleased: 1});
    expect(row?.intendedReservationId).toBeNull();
    expect(row?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(remainingReservations).toHaveLength(0);
  });

  it('skips fresh rows, live provisioners, terminal rows, running jobs, and fresh sessions', async () => {
    await createRunnerInstance({
      providerRunnerId: 'fresh-row',
      reportedAt: new Date(),
      updatedAt: new Date(),
    });
    await createRunnerInstance({
      providerRunnerId: 'live-provisioner',
      reportedAt: staleAt(),
      updatedAt: staleAt(),
    });
    await createRunnerInstance({
      providerRunnerId: 'terminal-row',
      reportedAt: staleAt(),
      updatedAt: staleAt(),
      state: 'failed',
    });
    await createRunnerInstance({
      providerRunnerId: 'running-job',
      reportedAt: staleAt(),
      updatedAt: staleAt(),
    });
    await insertRunningJob({providerRunnerId: 'running-job'});
    const freshSession = await createRunnerInstance({
      providerRunnerId: 'fresh-session',
      reportedAt: staleAt(),
      updatedAt: staleAt(),
    });
    await createLinkedSession({
      providerRunnerId: freshSession.providerRunnerId,
      updatedAt: new Date(),
    });
    await db()
      .update(provisionerTokens)
      .set({lastSeenAt: new Date()})
      .where(eq(provisionerTokens.id, provisionerId));

    const result = await reapStaleRunnerInstances({thresholdSeconds: 60, limit: 100});

    const rows = await providerRunnerRowsFor({workspaceId, provisionerId}).orderBy(
      providerRunners.providerRunnerId,
    );
    expect(result).toEqual({reaped: 0, reservationsReleased: 0});
    expect(rows.map((row) => [row.providerRunnerId, row.state])).toEqual([
      ['fresh-row', 'running'],
      ['fresh-session', 'running'],
      ['live-provisioner', 'running'],
      ['running-job', 'running'],
      ['terminal-row', 'failed'],
    ]);
  });

  it('releases reservations for stale rows whose linked session is no longer live', async () => {
    const reservationId = await createReservation(1);
    await createRunnerInstance({
      providerRunnerId: 'stale-session',
      reservationId,
      runnerSessionId: '00000000-0000-4000-8000-000000000001',
      reportedAt: staleAt(),
      updatedAt: staleAt(),
    });
    const session = await createLinkedSession({
      providerRunnerId: 'stale-session',
      updatedAt: staleAt(),
    });
    await db()
      .update(providerRunners)
      .set({runnerSessionId: session.id})
      .where(eq(providerRunners.providerRunnerId, 'stale-session'));

    const result = await reapStaleRunnerInstances({thresholdSeconds: 60, limit: 100});

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    const [providerRunner] = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({reaped: 1, reservationsReleased: 1});
    expect(providerRunner?.state).toBe('failed');
    expect(providerRunner?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(reservationRows.find((row) => row.id === reservationId)).toBeUndefined();
  });

  it('drains stale terminal rows with unreleased session-linked reservations', async () => {
    const reservationId = await createReservation(1);
    const session = await createLinkedSession({
      providerRunnerId: 'legacy-terminal-runner',
      updatedAt: staleAt(),
    });
    await createRunnerInstance({
      providerRunnerId: 'legacy-terminal-runner',
      reservationId,
      runnerSessionId: session.id,
      state: 'failed',
      reportedAt: staleAt(),
      updatedAt: staleAt(),
    });

    const result = await reapStaleRunnerInstances({thresholdSeconds: 60, limit: 100});

    const [providerRunner] = await providerRunnerRowsFor({workspaceId, provisionerId});
    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    expect(result).toEqual({reaped: 0, reservationsReleased: 1});
    expect(providerRunner?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(reservationRows).toHaveLength(0);
  });

  it('flags expired releases and drains only the configured batch size', async () => {
    const activeReservationId = await createReservation(2);
    const expiredReservationId = await createReservation(1, {
      expiresAt: new Date(Date.now() - 60_000),
    });
    await createRunnerInstance({
      providerRunnerId: 'stale-1',
      reservationId: activeReservationId,
      reportedAt: staleAt(240_000),
      updatedAt: staleAt(240_000),
    });
    await createRunnerInstance({
      providerRunnerId: 'stale-2',
      reservationId: expiredReservationId,
      reportedAt: staleAt(180_000),
      updatedAt: staleAt(180_000),
    });
    await createRunnerInstance({
      providerRunnerId: 'stale-3',
      reportedAt: staleAt(120_000),
      updatedAt: staleAt(120_000),
    });

    const first = await reapStaleRunnerInstances({thresholdSeconds: 60, limit: 2});
    const second = await reapStaleRunnerInstances({thresholdSeconds: 60, limit: 2});

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    const providerRunnerRows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(first).toEqual({reaped: 2, reservationsReleased: 1});
    expect(second).toEqual({reaped: 1, reservationsReleased: 0});
    expect(reservationRows.find((row) => row.id === activeReservationId)?.count).toBe(1);
    expect(reservationRows.find((row) => row.id === expiredReservationId)?.count).toBe(1);
    expect(providerRunnerRows.every((row) => row.state === 'failed')).toBe(true);
    expect(
      providerRunnerRows
        .filter((row) => row.reservationId)
        .every((row) => row.reservationReleasedAt instanceof Date),
    ).toBe(true);
  });

  it('waits for reservation assignment locks before releasing terminal runners', async () => {
    const reservationId = await createReservation(1);
    const runner = await createRunnerInstance({
      providerRunnerId: 'terminal-assignment-race',
      reservationId,
      state: 'failed',
      reportedAt: staleAt(),
      updatedAt: staleAt(),
    });
    const releaseLock = deferred<void>();
    const lockHolderReady = deferred<void>();
    const lockHolder = db().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`runners_assignment:${provisionerId}:${reservationId}`}))`,
      );
      lockHolderReady.resolve();
      await releaseLock.promise;
    });

    const cleanup = (async () => {
      await lockHolderReady.promise;
      return await db().transaction((tx) =>
        releaseTerminalRunnerInstanceReservationsByIds(tx, {
          workspaceId,
          provisionerId,
          runnerInstanceIds: [runner.id],
          requireUnlinkedSession: false,
        }),
      );
    })();

    try {
      await waitForLockWait({queryLike: '%pg_advisory_xact_lock%'});
      const [beforeRunner] = await providerRunnerRowsFor({workspaceId, provisionerId});
      const [beforeReservation] = await reservationRowsFor({workspaceId, provisionerId});
      expect(beforeRunner?.reservationReleasedAt).toBeNull();
      expect(beforeReservation?.count).toBe(1);
    } finally {
      releaseLock.resolve();
      await Promise.all([cleanup, lockHolder]);
    }

    const [providerRunner] = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(providerRunner?.reservationReleasedAt).toBeInstanceOf(Date);
  });

  it('does not double-release reservations when terminal report and reaper queue on the workspace lock', async () => {
    const reservationId = await createReservation(2);
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-1',
      reservationId,
      reportedAt: staleAt(),
      updatedAt: staleAt(),
    });
    const releaseWorkspaceLock = deferred<void>();
    const lockHolderReady = deferred<void>();
    const lockHolder = db().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
      lockHolderReady.resolve();
      await releaseWorkspaceLock.promise;
    });

    await lockHolderReady.promise;
    const report = reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'failed',
          reportedAt: new Date(),
        }),
      ],
    });
    await waitForLockWait({queryLike: '%pg_advisory_xact_lock%'});
    const reaper = reapStaleRunnerInstances({thresholdSeconds: 60, limit: 100});
    try {
      await waitForLockWait({minWaiters: 2, queryLike: '%pg_advisory_xact_lock%'});
    } finally {
      releaseWorkspaceLock.resolve();
    }
    const [reportResult, reaperResult] = await Promise.all([report, reaper, lockHolder]);

    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    const [providerRunner] = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(reportResult.reservationsReleased + reaperResult.reservationsReleased).toBe(1);
    expect(providerRunner?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(reservation?.count).toBe(1);
  });

  async function createReservation(count: number, overrides?: {expiresAt?: Date}): Promise<string> {
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count,
      expiresAt: overrides?.expiresAt ?? new Date(Date.now() + 60_000),
    });
    const [reservation] = await db()
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.workspaceId, workspaceId),
          eq(reservations.provisionerId, provisionerId),
        ),
      )
      .orderBy(desc(reservations.id))
      .limit(1);
    if (!reservation) throw new Error('Expected reservation');
    return reservation.id;
  }

  async function createRunnerInstance(params: {
    providerRunnerId: string;
    reservationId?: string | null;
    runnerSessionId?: string | null;
    reportedAt: Date;
    updatedAt: Date;
    state?: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'terminated';
  }) {
    const row = await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: params.providerRunnerId,
      reservationId: params.reservationId ?? null,
      runnerSessionId: params.runnerSessionId ?? null,
      reportedAt: params.reportedAt,
      state: params.state ?? 'running',
    });
    await db()
      .update(providerRunners)
      .set({updatedAt: params.updatedAt})
      .where(eq(providerRunners.id, row.id));
    return {...row, updatedAt: params.updatedAt};
  }

  async function createLinkedSession(params: {providerRunnerId: string; updatedAt: Date}) {
    const session = await runnerSessionFactory.create({workspaceId});
    await db()
      .update(runnerSessions)
      .set({
        registrationTokenKind: 'ephemeral',
        provisionerId,
        providerRunnerId: params.providerRunnerId,
        maxClaims: 1,
        updatedAt: params.updatedAt,
      })
      .where(eq(runnerSessions.id, session.id));
    return session;
  }

  async function insertRunningJob(params: {providerRunnerId: string}) {
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
        provisionerId,
        providerRunnerId: params.providerRunnerId,
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
        startedAt: new Date('2025-01-01T00:00:00.000Z'),
        lastHeartbeatAt: new Date('2025-01-01T00:00:00.000Z'),
      });
  }

  function staleAt(ageMs = 120_000): Date {
    return new Date(Date.now() - ageMs);
  }

  function event(params: {
    providerRunnerId: string;
    reservationId?: string | null;
    state?: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'terminated';
    reportedAt?: Date;
  }) {
    return {
      providerRunnerId: params.providerRunnerId,
      reservationId: params.reservationId ?? null,
      templateKey: 'linux',
      labels: ['linux'],
      state: params.state ?? 'running',
      reason: null,
      runnerSessionId: null,
      providerKind: 'docker',
      reportedAt: params.reportedAt ?? new Date(),
    };
  }
});

describe('reconcileRunnerInstances', () => {
  let workspaceId: string;
  let provisionerId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    provisionerId = crypto.randomUUID();
  });

  it('terminates stale absent provisioned runners and releases reservations', async () => {
    const reservationId = await createReservation(2);
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-1',
      reservationId,
      reportedAt: staleReportedAt(),
    });

    const result = await reconcileRunnerInstances({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: ['observed-runner'],
      terminateGraceSeconds: 60,
    });

    const [providerRunner] = await providerRunnerRowsFor({workspaceId, provisionerId});
    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    expect(result.absentIds).toEqual(['provisioned-runner-1']);
    expect(result.reservationsReleased).toBe(1);
    expect(providerRunner?.state).toBe('terminated');
    expect(providerRunner?.terminatedAt).toBeInstanceOf(Date);
    expect(reservation?.count).toBe(1);
  });

  it('releases reservations when reconciling stale installation runners', async () => {
    const reservationWorkspaceId = crypto.randomUUID();
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId: reservationWorkspaceId,
        provisionerId,
        requiredLabels: ['linux'],
        count: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!reservation) throw new Error('Expected reservation');
    const [runner] = await db()
      .insert(providerRunners)
      .values({
        workspaceId: null,
        provisionerId,
        providerRunnerId: 'stale-installation-runner',
        reservationId: reservation.id,
        runnerSessionId: crypto.randomUUID(),
        state: 'running',
        reportedAt: staleReportedAt(),
        updatedAt: staleReportedAt(),
      })
      .returning({id: providerRunners.id});
    if (!runner) throw new Error('Expected runner');

    const result = await reconcileRunnerInstances({
      workspaceId: null,
      provisionerId,
      observedRunnerInstanceIds: ['observed-runner'],
      terminateGraceSeconds: 60,
    });

    const [providerRunner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    const [remainingReservation] = await db()
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservation.id));
    expect(result).toMatchObject({
      absentIds: ['stale-installation-runner'],
      reservationsReleased: 1,
    });
    expect(providerRunner).toMatchObject({state: 'terminated'});
    expect(providerRunner?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(remainingReservation).toBeUndefined();
  });

  it('treats an empty observed set as read-only', async () => {
    const reservationId = await createReservation(2);
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-1',
      reservationId,
      reportedAt: staleReportedAt(),
    });

    const result = await reconcileRunnerInstances({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: [],
      terminateGraceSeconds: 60,
    });

    const [providerRunner] = await providerRunnerRowsFor({workspaceId, provisionerId});
    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    expect(result.absentIds).toEqual([]);
    expect(result.reservationsReleased).toBe(0);
    expect(providerRunner?.state).toBe('running');
    expect(providerRunner?.terminatedAt).toBeNull();
    expect(providerRunner?.reservationReleasedAt).toBeNull();
    expect(reservation?.count).toBe(2);
  });

  it('keeps fresh absent provisioned runners inside the grace window', async () => {
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-1',
      reportedAt: new Date(),
    });

    const result = await reconcileRunnerInstances({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: ['observed-runner'],
      terminateGraceSeconds: 60,
    });

    const [providerRunner] = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(result.absentIds).toEqual([]);
    expect(result.reservationsReleased).toBe(0);
    expect(providerRunner?.state).toBe('running');
  });

  it('authorizes an exhausted ephemeral session only after the exit grace', async () => {
    const providerRunnerId = 'exhausted-runner';
    await createRunnerInstance({providerRunnerId});
    const session = await createEphemeralSession({providerRunnerId});

    const beforeGrace = await reconcileRunnerInstancesCore({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: [providerRunnerId],
    });
    expect(beforeGrace.runners).toMatchObject([{providerRunnerId, desiredIntent: 'keep'}]);

    const [beforeAuthorization] = await db()
      .select({terminationAuthorizedAt: providerRunners.terminationAuthorizedAt})
      .from(providerRunners)
      .where(eq(providerRunners.providerRunnerId, providerRunnerId));
    expect(beforeAuthorization?.terminationAuthorizedAt).toBeNull();

    await db()
      .update(runnerSessions)
      .set({updatedAt: new Date(Date.now() - 120_000)})
      .where(eq(runnerSessions.id, session.id));

    const afterGrace = await reconcileRunnerInstancesCore({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: [providerRunnerId],
    });

    expect(afterGrace.runners).toMatchObject([
      {providerRunnerId, desiredIntent: 'terminate', desiredIntentReason: 'session-exhausted'},
    ]);
    const [afterAuthorization] = await db()
      .select({
        terminationAuthorizedAt: providerRunners.terminationAuthorizedAt,
        terminationReason: providerRunners.terminationReason,
      })
      .from(providerRunners)
      .where(eq(providerRunners.providerRunnerId, providerRunnerId));
    expect(afterAuthorization?.terminationAuthorizedAt).toBeInstanceOf(Date);
    expect(afterAuthorization?.terminationReason).toBe('session-exhausted');
  });

  it('keeps an exhausted ephemeral session while a live job is bound to its runner', async () => {
    const providerRunnerId = 'busy-exhausted-runner';
    await createRunnerInstance({providerRunnerId});
    const session = await createEphemeralSession({
      providerRunnerId,
      updatedAt: new Date(Date.now() - 120_000),
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
        runnerSessionId: session.id,
        provisionerId,
        providerRunnerId,
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
        startedAt: new Date(Date.now() - 120_000),
        lastHeartbeatAt: new Date(),
      });

    const result = await reconcileRunnerInstancesCore({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: [providerRunnerId],
    });

    expect(result.runners).toMatchObject([{providerRunnerId, desiredIntent: 'keep'}]);
    const [runner] = await db()
      .select({terminationAuthorizedAt: providerRunners.terminationAuthorizedAt})
      .from(providerRunners)
      .where(eq(providerRunners.providerRunnerId, providerRunnerId));
    expect(runner?.terminationAuthorizedAt).toBeNull();
  });

  it('does not treat reusable managed sessions as exhausted one-job sessions', async () => {
    const providerRunnerId = 'reusable-runner';
    await createRunnerInstance({providerRunnerId});
    await createEphemeralSession({
      providerRunnerId,
      maxClaims: 2,
      claimsUsed: 2,
      updatedAt: new Date(Date.now() - 120_000),
    });

    const result = await reconcileRunnerInstancesCore({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: [providerRunnerId],
    });

    expect(result.runners).toMatchObject([{providerRunnerId, desiredIntent: 'keep'}]);
  });

  it('recovers an exhausted activated one-job session through the same path', async () => {
    const providerRunnerId = 'activated-exhausted-runner';
    const runner = await createRunnerInstance({providerRunnerId});
    await createEphemeralSession({
      providerRunnerId,
      kind: 'activation',
      runnerInstanceId: runner.id,
      updatedAt: new Date(Date.now() - 120_000),
    });

    const result = await reconcileRunnerInstancesCore({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: [providerRunnerId],
    });

    expect(result.runners).toMatchObject([
      {providerRunnerId, desiredIntent: 'terminate', desiredIntentReason: 'session-exhausted'},
    ]);
  });

  it('keeps a live job when terminal completion races session-exhausted reconciliation', async () => {
    const providerRunnerId = 'completion-race-runner';
    await createRunnerInstance({providerRunnerId});
    const session = await createEphemeralSession({
      providerRunnerId,
      updatedAt: new Date(Date.now() - 120_000),
    });
    const jobExecutionId = crypto.randomUUID();
    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        jobId: crypto.randomUUID(),
        jobExecutionId,
        projectId: crypto.randomUUID(),
        runnerSessionId: session.id,
        provisionerId,
        providerRunnerId,
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
        startedAt: new Date(Date.now() - 120_000),
        lastHeartbeatAt: new Date(),
      });

    const releaseWorkspaceLock = deferred<void>();
    const workspaceLockReady = deferred<void>();
    const lockHolder = db().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
      workspaceLockReady.resolve();
      await releaseWorkspaceLock.promise;
    });

    await workspaceLockReady.promise;
    // Queue reconciliation before completion. PostgreSQL hands these advisory-lock waiters off
    // FIFO, so reconciliation observes the live lease before completion removes it.
    const reconciliation = reconcileRunnerInstancesCore({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: [providerRunnerId],
    });
    await waitForLockWait({queryLike: '%pg_advisory_xact_lock%'});
    const completion = reconcileTerminalJobExecution({jobExecutionId});
    try {
      await waitForLockWait({minWaiters: 2, queryLike: '%pg_advisory_xact_lock%'});
    } finally {
      releaseWorkspaceLock.resolve();
    }

    const [result] = await Promise.all([reconciliation, completion, lockHolder]);

    expect(result.runners).toMatchObject([{providerRunnerId, desiredIntent: 'keep'}]);
    const [runner] = await db()
      .select({terminationAuthorizedAt: providerRunners.terminationAuthorizedAt})
      .from(providerRunners)
      .where(eq(providerRunners.providerRunnerId, providerRunnerId));
    expect(runner?.terminationAuthorizedAt).toBeNull();
  });

  it('keeps a runner when terminal completion commits before session-exhausted reconciliation', async () => {
    const providerRunnerId = 'completion-before-reconcile-runner';
    await createRunnerInstance({providerRunnerId});
    const session = await createEphemeralSession({
      providerRunnerId,
      updatedAt: new Date(Date.now() - 120_000),
    });
    const jobExecutionId = crypto.randomUUID();
    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        jobId: crypto.randomUUID(),
        jobExecutionId,
        projectId: crypto.randomUUID(),
        runnerSessionId: session.id,
        provisionerId,
        providerRunnerId,
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
        startedAt: new Date(Date.now() - 120_000),
        lastHeartbeatAt: new Date(),
      });

    const releaseWorkspaceLock = deferred<void>();
    const workspaceLockReady = deferred<void>();
    const lockHolder = db().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
      workspaceLockReady.resolve();
      await releaseWorkspaceLock.promise;
    });

    await workspaceLockReady.promise;
    const completion = reconcileTerminalJobExecution({
      jobExecutionId,
      finishedAt: new Date(),
    });
    await waitForLockWait({queryLike: '%pg_advisory_xact_lock%'});
    releaseWorkspaceLock.resolve();
    await completion;
    await lockHolder;

    const result = await reconcileRunnerInstancesCore({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: [providerRunnerId],
    });

    expect(result.runners).toMatchObject([{providerRunnerId, desiredIntent: 'keep'}]);
    const [runner] = await db()
      .select({terminationAuthorizedAt: providerRunners.terminationAuthorizedAt})
      .from(providerRunners)
      .where(eq(providerRunners.providerRunnerId, providerRunnerId));
    expect(runner?.terminationAuthorizedAt).toBeNull();
  });

  it('respects a fresh report that commits after reconcile selects a stale absent row', async () => {
    const reservationId = await createReservation(1);
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-1',
      reservationId,
      reportedAt: staleReportedAt(),
    });
    const releaseReportTransaction = deferred<void>();
    const reportTransactionUpdated = deferred<void>();

    const reportTransaction = db().transaction(async (tx) => {
      await tx
        .update(providerRunners)
        .set({reportedAt: sql`now()`, updatedAt: sql`now()`})
        .where(
          and(
            eq(providerRunners.workspaceId, workspaceId),
            eq(providerRunners.provisionerId, provisionerId),
            eq(providerRunners.providerRunnerId, 'provisioned-runner-1'),
          ),
        );
      reportTransactionUpdated.resolve();
      await releaseReportTransaction.promise;
    });

    await reportTransactionUpdated.promise;
    const reconcile = reconcileRunnerInstances({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: ['observed-runner'],
      terminateGraceSeconds: 60,
    });
    try {
      await waitForLockWait({queryLike: '%runner_instances%'});
    } finally {
      releaseReportTransaction.resolve();
    }
    const [result] = await Promise.all([reconcile, reportTransaction]);

    const [providerRunner] = await providerRunnerRowsFor({workspaceId, provisionerId});
    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    expect(result.absentIds).toEqual([]);
    expect(result.reservationsReleased).toBe(0);
    expect(providerRunner?.state).toBe('running');
    expect(providerRunner?.reservationReleasedAt).toBeNull();
    expect(reservation?.count).toBe(1);
  });

  it('terminates only stale rows when the observed set is non-empty', async () => {
    await createRunnerInstance({
      providerRunnerId: 'stale-runner',
      reportedAt: staleReportedAt(),
    });
    await createRunnerInstance({
      providerRunnerId: 'fresh-runner',
      reportedAt: new Date(),
    });

    const result = await reconcileRunnerInstances({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: ['observed-runner'],
      terminateGraceSeconds: 60,
    });

    const rows = await providerRunnerRowsFor({workspaceId, provisionerId}).orderBy(
      providerRunners.providerRunnerId,
    );
    expect(result.absentIds).toEqual(['stale-runner']);
    expect(rows.map((row) => [row.providerRunnerId, row.state])).toEqual([
      ['fresh-runner', 'running'],
      ['stale-runner', 'terminated'],
    ]);
  });

  it('releases reservation units, deletes one-unit reservations, and flags expired releases', async () => {
    const sharedReservationId = await createReservation(3);
    const oneUnitReservationId = await createReservation(1);
    const expiredReservationId = await createReservation(1, {
      expiresAt: new Date(Date.now() - 60_000),
    });
    await createRunnerInstance({
      providerRunnerId: 'shared-1',
      reservationId: sharedReservationId,
      reportedAt: staleReportedAt(),
    });
    await createRunnerInstance({
      providerRunnerId: 'shared-2',
      reservationId: sharedReservationId,
      reportedAt: staleReportedAt(),
    });
    await createRunnerInstance({
      providerRunnerId: 'one-unit',
      reservationId: oneUnitReservationId,
      reportedAt: staleReportedAt(),
    });
    await createRunnerInstance({
      providerRunnerId: 'expired',
      reservationId: expiredReservationId,
      reportedAt: staleReportedAt(),
    });

    const result = await reconcileRunnerInstances({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: ['observed-runner'],
      terminateGraceSeconds: 60,
    });

    const reservationRows = await reservationRowsFor({workspaceId, provisionerId});
    const providerRunnerRows = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(result.reservationsReleased).toBe(3);
    expect(reservationRows).toHaveLength(2);
    expect(reservationRows.find((row) => row.id === sharedReservationId)?.count).toBe(1);
    expect(reservationRows.find((row) => row.id === expiredReservationId)?.count).toBe(1);
    expect(reservationRows.find((row) => row.id === oneUnitReservationId)).toBeUndefined();
    expect(providerRunnerRows.every((row) => row.reservationReleasedAt instanceof Date)).toBe(true);
  });

  it('is idempotent across repeated reconciles', async () => {
    const reservationId = await createReservation(2);
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-1',
      reservationId,
      reportedAt: staleReportedAt(),
    });

    const first = await reconcileRunnerInstances({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: ['observed-runner'],
      terminateGraceSeconds: 60,
    });
    const second = await reconcileRunnerInstances({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: ['observed-runner'],
      terminateGraceSeconds: 60,
    });

    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    expect(first.reservationsReleased).toBe(1);
    expect(second.reservationsReleased).toBe(0);
    expect(reservation?.count).toBe(1);
  });

  it('does not touch provisioned runners from another workspace or provisioner', async () => {
    const otherWorkspaceId = crypto.randomUUID();
    const otherProvisionerId = crypto.randomUUID();
    await createRunnerInstance({
      providerRunnerId: 'owned-runner',
      reportedAt: staleReportedAt(),
    });
    await providerRunnerFactory.create({
      workspaceId: otherWorkspaceId,
      provisionerId,
      providerRunnerId: 'other-workspace-runner',
      reportedAt: staleReportedAt(),
      state: 'running',
    });
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId: otherProvisionerId,
      providerRunnerId: 'other-provisioner-runner',
      reportedAt: staleReportedAt(),
      state: 'running',
    });

    await reconcileRunnerInstances({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: ['observed-runner'],
      terminateGraceSeconds: 60,
    });

    const rows = await db()
      .select()
      .from(providerRunners)
      .where(
        or(
          and(
            eq(providerRunners.workspaceId, workspaceId),
            eq(providerRunners.provisionerId, provisionerId),
          ),
          and(
            eq(providerRunners.workspaceId, otherWorkspaceId),
            eq(providerRunners.provisionerId, provisionerId),
          ),
          and(
            eq(providerRunners.workspaceId, workspaceId),
            eq(providerRunners.provisionerId, otherProvisionerId),
          ),
        ),
      )
      .orderBy(providerRunners.providerRunnerId);
    expect(rows.map((row) => [row.providerRunnerId, row.state])).toEqual([
      ['other-provisioner-runner', 'running'],
      ['other-workspace-runner', 'running'],
      ['owned-runner', 'terminated'],
    ]);
  });

  it('terminates session-bound absent runners and releases their reservation', async () => {
    const reservationId = await createReservation(1);
    await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-1',
      reservationId,
      runnerSessionId: crypto.randomUUID(),
      reportedAt: staleReportedAt(),
    });

    const result = await reconcileRunnerInstances({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: ['observed-runner'],
      terminateGraceSeconds: 60,
    });

    const [providerRunner] = await providerRunnerRowsFor({workspaceId, provisionerId});
    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    expect(result.reservationsReleased).toBe(1);
    expect(providerRunner?.state).toBe('terminated');
    expect(providerRunner?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(reservation).toBeUndefined();

    const poll = await pollDemandAndReserve({
      workspaceId,
      provisionerId,
      maxReservations: 1,
      ttlSeconds: 60,
      templates: [
        {templateKey: 'linux', labels: ['linux'], availableSlots: 1, starting: 0, running: 0},
      ],
    });
    expect(poll.reservations).toHaveLength(1);
    expect(poll.reservations[0]?.count).toBe(1);
    expect(poll.stats[0]).toMatchObject({labels: ['linux'], queued: 1, reserved: 1});
  });

  it('returns a deterministic newest running job execution bound to an observed provisioned runner', async () => {
    await createRunnerInstance({providerRunnerId: 'provisioned-runner-1'});
    const lowerJobId = '00000000-0000-4000-8000-000000000001';
    const higherJobId = '00000000-0000-4000-8000-000000000002';
    const lowerJobExecutionId = '10000000-0000-4000-8000-000000000001';
    const higherJobExecutionId = '10000000-0000-4000-8000-000000000002';
    await insertRunningJob({
      jobId: lowerJobId,
      jobExecutionId: lowerJobExecutionId,
      providerRunnerId: 'provisioned-runner-1',
      startedAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    await insertRunningJob({
      jobId: higherJobId,
      jobExecutionId: higherJobExecutionId,
      providerRunnerId: 'provisioned-runner-1',
      startedAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    const result = await reconcileRunnerInstances({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: ['provisioned-runner-1'],
      terminateGraceSeconds: 60,
    });

    expect(
      result.boundJobExecutionsByRunnerInstanceId.get('provisioned-runner-1')?.jobExecutionId,
    ).toBe(higherJobExecutionId);
  });

  it('does not let a later running report revive a reconcile-terminated runner', async () => {
    const reportedAt = staleReportedAt();
    await createRunnerInstance({providerRunnerId: 'provisioned-runner-1', reportedAt});
    await reconcileRunnerInstances({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: ['observed-runner'],
      terminateGraceSeconds: 60,
    });

    await reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          state: 'running',
          reportedAt: new Date(reportedAt.getTime() + 120_000),
        }),
      ],
    });

    const [providerRunner] = await providerRunnerRowsFor({workspaceId, provisionerId});
    expect(providerRunner?.state).toBe('terminated');
  });

  it('does not double-release reservations when terminal report and reconcile queue on the workspace lock', async () => {
    const reservationId = await createReservation(2);
    await createRunnerInstance({
      providerRunnerId: 'provisioned-runner-1',
      reservationId,
      reportedAt: staleReportedAt(),
    });
    const releaseWorkspaceLock = deferred<void>();
    const lockHolderReady = deferred<void>();
    const lockHolder = db().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
      lockHolderReady.resolve();
      await releaseWorkspaceLock.promise;
    });

    await lockHolderReady.promise;
    const report = reportRunnerInstances({
      scope: 'workspace',
      workspaceId,
      provisionerId,
      events: [
        event({
          providerRunnerId: 'provisioned-runner-1',
          reservationId,
          state: 'failed',
          reportedAt: new Date(),
        }),
      ],
    });
    await waitForLockWait({queryLike: '%pg_advisory_xact_lock%'});
    const reconcile = reconcileRunnerInstances({
      workspaceId,
      provisionerId,
      observedRunnerInstanceIds: ['observed-runner'],
      terminateGraceSeconds: 60,
    });
    try {
      await waitForLockWait({minWaiters: 2, queryLike: '%pg_advisory_xact_lock%'});
    } finally {
      releaseWorkspaceLock.resolve();
    }
    const [reportResult, reconcileResult] = await Promise.all([report, reconcile, lockHolder]);

    const [providerRunner] = await providerRunnerRowsFor({workspaceId, provisionerId});
    const [reservation] = await reservationRowsFor({workspaceId, provisionerId});
    expect(reportResult.reservationsReleased + reconcileResult.reservationsReleased).toBe(1);
    expect(providerRunner?.state).toSatisfy(
      (state: string | undefined) => state === 'failed' || state === 'terminated',
    );
    expect(providerRunner?.reservationReleasedAt).toBeInstanceOf(Date);
    expect(reservation?.count).toBe(1);
  });

  async function createReservation(count: number, overrides?: {expiresAt?: Date}): Promise<string> {
    await reservationFactory.create({
      workspaceId,
      provisionerId,
      requiredLabels: ['linux'],
      count,
      expiresAt: overrides?.expiresAt ?? new Date(Date.now() + 60_000),
    });
    const [reservation] = await db()
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.workspaceId, workspaceId),
          eq(reservations.provisionerId, provisionerId),
        ),
      )
      .orderBy(desc(reservations.id))
      .limit(1);
    if (!reservation) throw new Error('Expected reservation');
    return reservation.id;
  }

  async function createRunnerInstance(params: {
    providerRunnerId: string;
    reservationId?: string | null;
    runnerSessionId?: string | null;
    reportedAt?: Date;
  }) {
    return await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId: params.providerRunnerId,
      reservationId: params.reservationId ?? null,
      runnerSessionId: params.runnerSessionId ?? null,
      reportedAt: params.reportedAt ?? new Date(),
      state: 'running',
    });
  }

  async function createEphemeralSession(params: {
    providerRunnerId: string;
    kind?: 'ephemeral' | 'activation';
    runnerInstanceId?: string;
    maxClaims?: number;
    claimsUsed?: number;
    updatedAt?: Date;
  }) {
    const [session] = await db()
      .insert(runnerSessions)
      .values({
        workspaceId,
        scope: 'workspace',
        registrationTokenId: crypto.randomUUID(),
        registrationTokenKind: params.kind ?? 'ephemeral',
        runnerInstanceId: params.runnerInstanceId,
        provisionerId,
        providerRunnerId: params.providerRunnerId,
        labels: ['linux'],
        maxClaims: params.maxClaims ?? 1,
        claimsUsed: params.claimsUsed ?? 1,
        updatedAt: params.updatedAt ?? new Date(),
      })
      .returning({id: runnerSessions.id});
    if (!session) throw new Error('Expected runner session');
    return session;
  }

  async function insertRunningJob(params: {
    jobId: string;
    jobExecutionId?: string;
    providerRunnerId: string;
    startedAt: Date;
  }) {
    const runnerSession = await runnerSessionFactory.create({workspaceId});

    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        jobId: params.jobId,
        jobExecutionId: params.jobExecutionId ?? crypto.randomUUID(),
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        runnerSessionId: runnerSession.id,
        provisionerId,
        providerRunnerId: params.providerRunnerId,
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
        startedAt: params.startedAt,
        lastHeartbeatAt: params.startedAt,
      });
  }

  function staleReportedAt(): Date {
    return new Date(Date.now() - 120_000);
  }

  function event(params: {
    providerRunnerId: string;
    reservationId?: string | null;
    state?: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'terminated';
    reportedAt?: Date;
  }) {
    return {
      providerRunnerId: params.providerRunnerId,
      reservationId: params.reservationId ?? null,
      templateKey: 'linux',
      labels: ['linux'],
      state: params.state ?? 'running',
      reason: null,
      runnerSessionId: null,
      providerKind: 'docker',
      reportedAt: params.reportedAt ?? new Date(),
    };
  }
});

describe('countStaleEnrolledRunnerInstances', () => {
  let provisionerId: string;

  beforeEach(() => {
    provisionerId = crypto.randomUUID();
  });

  function staleAt(): Date {
    return new Date(Date.now() - 120_000);
  }

  it('counts only stale reported runners with a live control session and no assignment', async () => {
    const baseline = await countStaleEnrolledRunnerInstances({graceSeconds: 60});
    const stale = await createRunner({updatedAt: staleAt()});
    await createControlSession(stale);

    const fresh = await createRunner({updatedAt: new Date()});
    await createControlSession(fresh);

    const recentlyMutated = await createRunner({reportedAt: staleAt(), updatedAt: new Date()});
    await createControlSession(recentlyMutated);

    const freshReport = await createRunner({reportedAt: new Date(), updatedAt: staleAt()});
    await createControlSession(freshReport);

    const assigned = await createRunner({workspaceId: crypto.randomUUID(), updatedAt: staleAt()});
    await createControlSession(assigned);

    const activated = await createRunner({
      runnerSessionId: crypto.randomUUID(),
      updatedAt: staleAt(),
    });
    await createControlSession(activated);

    await createRunner({updatedAt: staleAt()});
    const expiredControlSession = await createRunner({updatedAt: staleAt()});
    await createControlSession(expiredControlSession, {
      expiresAt: new Date(Date.now() - 1_000),
    });
    const closedControlSession = await createRunner({updatedAt: staleAt()});
    await createControlSession(closedControlSession, {
      closedAt: new Date(),
    });
    const stopped = await createRunner({state: 'stopped', updatedAt: staleAt()});
    await createControlSession(stopped);

    const count = await countStaleEnrolledRunnerInstances({graceSeconds: 60});

    expect(count - baseline).toBe(2);
  });

  async function createRunner(params: {
    state?: 'running' | 'stopped';
    workspaceId?: string | null;
    runnerSessionId?: string | null;
    reportedAt?: Date;
    updatedAt?: Date;
  }) {
    const reportedAt = params.reportedAt ?? params.updatedAt ?? new Date();
    const [runner] = await db()
      .insert(providerRunners)
      .values({
        workspaceId: params.workspaceId ?? null,
        provisionerId,
        providerRunnerId: crypto.randomUUID(),
        templateKey: 'linux',
        labels: ['linux'],
        state: params.state ?? 'running',
        runnerSessionId: params.runnerSessionId ?? null,
        providerKind: 'docker',
        reportedAt,
        updatedAt: params.updatedAt ?? reportedAt,
      })
      .returning({id: providerRunners.id});
    if (!runner) throw new Error('Expected runner instance');
    return runner.id;
  }

  async function createControlSession(
    runnerInstanceId: string,
    params: {expiresAt?: Date; closedAt?: Date} = {},
  ) {
    await db()
      .insert(runnerControlSessions)
      .values({
        runnerInstanceId,
        provisionerId,
        hashedToken: crypto.randomUUID(),
        prefix: 'test',
        expiresAt: params.expiresAt ?? new Date(Date.now() + 60_000),
        closedAt: params.closedAt,
        closeReason: params.closedAt ? 'test' : null,
      });
  }
});

describe('listProviderRunnerByPhaseMetrics', () => {
  it('groups runners by the lifecycle phase that is currently blocking activation', async () => {
    const provisionerId = crypto.randomUUID();
    const provider = `metrics-test-${crypto.randomUUID()}`;
    const reservationId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const old = new Date(Date.now() - 120_000);

    const createRunner = async (params: {
      state: 'starting' | 'running';
      launchKind: 'demand' | 'warm' | 'manual';
      intendedReservationId?: string | null;
      workspaceId?: string | null;
      reservationId?: string | null;
      assignedAt?: Date | null;
      createdAt?: Date;
    }) => {
      const [runner] = await db()
        .insert(providerRunners)
        .values({
          provisionerId,
          providerRunnerId: crypto.randomUUID(),
          providerKind: provider,
          launchKind: params.launchKind,
          intendedReservationId: params.intendedReservationId ?? null,
          workspaceId: params.workspaceId ?? null,
          reservationId: params.reservationId ?? null,
          assignedAt: params.assignedAt ?? null,
          state: params.state,
          labels: ['linux'],
          reportedAt: new Date(),
          createdAt: params.createdAt ?? old,
        })
        .returning({id: providerRunners.id});
      if (!runner) throw new Error('Expected runner instance');
      return runner.id;
    };

    await createRunner({state: 'starting', launchKind: 'demand'});
    const enrollmentRunnerId = await createRunner({state: 'starting', launchKind: 'warm'});
    const assignmentRunnerId = await createRunner({
      state: 'running',
      launchKind: 'demand',
      intendedReservationId: reservationId,
    });
    const activationRunnerId = await createRunner({
      state: 'running',
      launchKind: 'manual',
      workspaceId,
      reservationId,
      assignedAt: old,
    });
    const idleRunnerId = await createRunner({state: 'running', launchKind: 'warm'});
    const demandIdleRunnerId = await createRunner({state: 'running', launchKind: 'demand'});

    await db()
      .insert(runnerControlSessions)
      .values(
        [
          enrollmentRunnerId,
          assignmentRunnerId,
          activationRunnerId,
          idleRunnerId,
          demandIdleRunnerId,
        ].map((runnerInstanceId) => ({
          runnerInstanceId,
          provisionerId,
          hashedToken: crypto.randomUUID(),
          prefix: 'metrics-test',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: old,
        })),
      );

    const metrics = await listProviderRunnerByPhaseMetrics();
    const ownMetrics = metrics.filter((metric) => metric.provider === provider);

    expect(ownMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({phase: 'control_session', launchKind: 'demand', count: 1}),
        expect.objectContaining({phase: 'enrollment', launchKind: 'warm', count: 1}),
        expect.objectContaining({phase: 'assignment', launchKind: 'demand', count: 1}),
        expect.objectContaining({phase: 'activation', launchKind: 'manual', count: 1}),
        expect.objectContaining({phase: 'idle', launchKind: 'warm', count: 1}),
        expect.objectContaining({phase: 'idle', launchKind: 'demand', count: 1}),
      ]),
    );
    expect(ownMetrics).toHaveLength(6);
  });
});

describe('listProviderRunnerByStateMetrics', () => {
  it('reports active runner counts and oldest provider age with bounded states', async () => {
    const provisionerId = crypto.randomUUID();
    const old = new Date(Date.now() - 120_000);

    await db()
      .insert(providerRunners)
      .values([
        {
          provisionerId,
          providerRunnerId: crypto.randomUUID(),
          state: 'running',
          labels: ['linux'],
          reportedAt: new Date(),
          createdAt: old,
        },
        {
          provisionerId,
          providerRunnerId: crypto.randomUUID(),
          state: 'stopping',
          labels: ['linux'],
          reportedAt: new Date(),
          createdAt: old,
        },
        {
          provisionerId,
          providerRunnerId: crypto.randomUUID(),
          state: 'terminated',
          labels: ['linux'],
          reportedAt: new Date(),
          createdAt: old,
        },
      ]);

    const metrics = await listProviderRunnerByStateMetrics();

    expect(metrics.find((metric) => metric.state === 'running')).toEqual(
      expect.objectContaining({count: expect.any(Number)}),
    );
    expect(
      metrics.find((metric) => metric.state === 'running')?.oldestAgeMilliseconds,
    ).toBeGreaterThan(100_000);
    expect(metrics.map((metric) => metric.state)).not.toContain('terminated');
  });
});

describe('runner instance provider attachment', () => {
  it('updates the pre-created runner instance before its first lifecycle report', async () => {
    const provisionerId = crypto.randomUUID();
    const providerRunnerId = 'ec2-runner-1';
    const [instance] = await db()
      .insert(providerRunners)
      .values({
        provisionerId,
        providerKind: 'ec2',
        templateKey: 'linux',
        labels: ['linux'],
        state: 'starting',
        reportedAt: new Date(),
      })
      .returning({id: providerRunners.id});
    if (!instance) throw new Error('Runner instance insert returned no row');

    const attached = await attachRunnerInstanceProviderId({
      runnerInstanceId: instance.id,
      provisionerId,
      providerRunnerId,
    });
    await reportRunnerInstances({
      scope: 'installation',
      workspaceId: null,
      provisionerId,
      events: [
        {
          providerRunnerId,
          reservationId: null,
          templateKey: 'linux',
          labels: ['linux'],
          state: 'starting',
          reason: null,
          runnerSessionId: null,
          providerKind: 'ec2',
          reportedAt: new Date(),
        },
      ],
    });
    const rows = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.provisionerId, provisionerId));

    expect(attached).toBe(true);
    expect(rows).toMatchObject([{id: instance.id, providerRunnerId, state: 'starting'}]);
  });

  it('belongs to its provisioner until it receives one provider runner identity', async () => {
    const provisionerId = crypto.randomUUID();
    const [instance] = await db()
      .insert(providerRunners)
      .values({
        provisionerId,
        providerKind: 'docker',
        templateKey: 'linux',
        labels: [],
        state: 'starting',
        reportedAt: new Date(),
      })
      .returning({id: providerRunners.id});
    if (!instance) throw new Error('Runner instance insert returned no row');

    const attached = await attachRunnerInstanceProviderId({
      runnerInstanceId: instance.id,
      provisionerId,
      providerRunnerId: 'container-1',
    });
    const rebound = await attachRunnerInstanceProviderId({
      runnerInstanceId: instance.id,
      provisionerId,
      providerRunnerId: 'container-2',
    });
    const [row] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.id, instance.id));

    expect(attached).toBe(true);
    expect(rebound).toBe(false);
    expect(row).toMatchObject({
      workspaceId: null,
      provisionerId,
      providerRunnerId: 'container-1',
      labels: [],
      state: 'starting',
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return {promise, resolve, reject};
}

async function waitForLockWait(params?: {minWaiters?: number; queryLike?: string}) {
  const minWaiters = params?.minWaiters ?? 1;
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await pgClient().query<{count: number}>(
      `
        SELECT count(*)::int AS count
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND ($1::text IS NULL OR query ILIKE $1)
      `,
      [params?.queryLike ?? null],
    );
    if ((result.rows[0]?.count ?? 0) >= minWaiters) return;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${minWaiters} blocked lock waiter(s)`);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
