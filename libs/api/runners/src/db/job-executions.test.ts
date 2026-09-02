import {
  RUNNER_JOB_CLAIMED,
  RUNNER_JOB_LEASE_EXPIRED,
  runnerJobClaimedEventSchema,
  runnerJobLeaseExpiredEventSchema,
} from '@shipfox/api-runners-dto';
import {pgClient} from '@shipfox/node-postgres';
import {eq, inArray, sql} from 'drizzle-orm';
import {EmptyRequiredLabelsError, RunnerSessionExhaustedError} from '#core/errors.js';
import {claimJobExecution} from '#core/job-executions.js';
import {detectAndExpireStuckJobs} from '#core/maintenance.js';
import * as runnerMetrics from '#metrics/instance.js';
import {
  getLeaseTokenClaims,
  pendingJobFactory,
  providerRunnerFactory,
  provisionerTokenFactory,
  runnerSessionFactory,
  runnersTestAuthClient,
} from '#test/index.js';
import {db} from './db.js';
import {
  claimPendingJobExecution as claimPendingJobExecutionDb,
  enqueueJobExecution,
  expireStuckJobExecutions,
  getJobExecutionCleanupStats,
  getJobExecutionQueueDepth,
  isJobLeaseActive,
  reconcileTerminalJobExecution,
  recordHeartbeat,
} from './job-executions.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobExecutions} from './schema/pending-job-executions.js';
import {reservations} from './schema/reservations.js';
import {providerRunners} from './schema/runner-instances.js';
import {runnerSessions} from './schema/runner-sessions.js';
import {runningJobExecutions} from './schema/running-job-executions.js';

const sessionLabels = ['linux', 'x64'];

function claimPendingJobExecution(
  params: Omit<
    Parameters<typeof claimPendingJobExecutionDb>[0],
    'maxClaims' | 'sessionLabels' | 'runnerSessionLivenessThrottleSeconds'
  > & {
    maxClaims?: number | null;
    sessionLabels?: string[];
    runnerSessionLivenessThrottleSeconds?: number;
  },
) {
  return claimPendingJobExecutionDb({
    ...params,
    maxClaims: params.maxClaims ?? null,
    sessionLabels: params.sessionLabels ?? sessionLabels,
    runnerSessionLivenessThrottleSeconds: params.runnerSessionLivenessThrottleSeconds ?? 10,
  });
}

async function outboxEventsForJob(eventType: string, jobId: string) {
  const rows = await db()
    .select()
    .from(runnersOutbox)
    .where(eq(runnersOutbox.eventType, eventType));
  return rows.filter((row) => (row.payload as {jobId?: string}).jobId === jobId);
}

describe('enqueueJobExecution', () => {
  it('stores a pending assignment row', async () => {
    const jobId = crypto.randomUUID();
    const jobExecutionId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    const workflowRunAttemptId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const queuedAt = new Date('2026-08-11T08:00:00.000Z');

    await enqueueJobExecution({
      workspaceId,
      workflowRunId,
      jobId,
      jobExecutionId,
      workflowRunAttemptId,
      projectId,
      requiredLabels: ['linux'],
      queuedAt,
    });

    const rows = await db()
      .select()
      .from(pendingJobExecutions)
      .where(eq(pendingJobExecutions.jobExecutionId, jobExecutionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.jobId).toBe(jobId);
    expect(rows[0]?.jobExecutionId).toBe(jobExecutionId);
    expect(rows[0]?.workflowRunId).toBe(workflowRunId);
    expect(rows[0]?.workflowRunAttemptId).toBe(workflowRunAttemptId);
    expect(rows[0]?.projectId).toBe(projectId);
    expect(rows[0]?.workspaceId).toBe(workspaceId);
    expect(rows[0]?.requiredLabels).toEqual(['linux']);
    expect(rows[0]?.createdAt).toEqual(queuedAt);
    expect(rows[0]).not.toHaveProperty('payload');
  });

  it('stores canonical required labels', async () => {
    const jobId = crypto.randomUUID();
    const jobExecutionId = crypto.randomUUID();

    await enqueueJobExecution({
      workspaceId: crypto.randomUUID(),
      jobId,
      jobExecutionId,
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      requiredLabels: ['Ubuntu22', ' ubuntu22 ', 'LINUX'],
      queuedAt: new Date(),
    });

    const rows = await db()
      .select()
      .from(pendingJobExecutions)
      .where(eq(pendingJobExecutions.jobId, jobId));
    expect(rows[0]?.requiredLabels).toEqual(['linux', 'ubuntu22']);
  });

  it('rejects empty required labels', async () => {
    await expect(
      enqueueJobExecution({
        workspaceId: crypto.randomUUID(),
        jobId: crypto.randomUUID(),
        jobExecutionId: crypto.randomUUID(),
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        requiredLabels: [],
        queuedAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(EmptyRequiredLabelsError);
  });

  it('is idempotent: scheduling the same jobId twice is a no-op', async () => {
    const jobId = crypto.randomUUID();
    const params = {
      workspaceId: crypto.randomUUID(),
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      jobId,
      jobExecutionId: crypto.randomUUID(),
      requiredLabels: ['linux'],
      queuedAt: new Date(),
    };

    await enqueueJobExecution(params);
    await expect(enqueueJobExecution(params)).resolves.toBeUndefined();

    const rows = await db()
      .select()
      .from(pendingJobExecutions)
      .where(eq(pendingJobExecutions.jobExecutionId, params.jobExecutionId));
    expect(rows).toHaveLength(1);
  });
});

describe('claimPendingJobExecution', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  it('emits runners.job.claimed carrying the claim instant on a real claim', async () => {
    const created = await pendingJobFactory.create({workspaceId});

    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});

    const [running] = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    const outbox = await outboxEventsForJob(RUNNER_JOB_CLAIMED, created.jobId);
    expect(outbox).toHaveLength(1);
    const payload = runnerJobClaimedEventSchema.parse(outbox[0]?.payload);
    expect(payload).toMatchObject({
      jobId: created.jobId,
      workflowRunId: created.workflowRunId,
      workflowRunAttemptId: created.workflowRunAttemptId,
      workspaceId,
      projectId: created.projectId,
      runnerLabels: sessionLabels,
    });
    expect(new Date(payload.claimedAt).getTime()).toBe(running?.startedAt.getTime());
    expect(payload.templateKey).toBeNull();
    expect(payload.provisionerId).toBeNull();
    expect(payload.provisionerScope).toBeNull();
    expect(payload.providerKind).toBeNull();
    expect(payload.launchKind).toBe('manual');
  });

  it('records queue time from the pending row creation to the runner claim', async () => {
    const created = await pendingJobFactory.create({workspaceId});
    await db()
      .update(pendingJobExecutions)
      .set({createdAt: sql`now() - interval '60 seconds'`})
      .where(eq(pendingJobExecutions.jobExecutionId, created.jobExecutionId));
    const [pending] = await db()
      .select({createdAt: pendingJobExecutions.createdAt})
      .from(pendingJobExecutions)
      .where(eq(pendingJobExecutions.jobExecutionId, created.jobExecutionId));
    const recordQueueTime = vi.spyOn(runnerMetrics, 'recordJobExecutionQueueTime');

    try {
      await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});

      const [running] = await db()
        .select({startedAt: runningJobExecutions.startedAt})
        .from(runningJobExecutions)
        .where(eq(runningJobExecutions.jobExecutionId, created.jobExecutionId));
      const observation = recordQueueTime.mock.calls[0]?.[0];
      if (!pending || !running) throw new Error('Expected pending and running job rows');
      expect(recordQueueTime).toHaveBeenCalledTimes(1);
      expect(observation).toMatchObject({provider: null, launchKind: 'manual'});
      expect(observation?.durationMilliseconds).toBe(
        running.startedAt.getTime() - pending.createdAt.getTime(),
      );
      expect(observation?.durationMilliseconds).toBeGreaterThanOrEqual(60_000);
      expect(observation?.durationMilliseconds).toBeLessThan(120_000);
    } finally {
      recordQueueTime.mockRestore();
    }
  });

  it.each([
    ['installation', 'provisioned-runner-installation'],
    ['workspace', 'provisioned-runner-workspace'],
  ] as const)('emits runner identity from the claimed rows for a %s provisioned runner claim', async (scope, providerRunnerId) => {
    const provisioner =
      scope === 'workspace'
        ? await provisionerTokenFactory.create({scope, workspaceId})
        : await provisionerTokenFactory.create({scope});
    const provisionerId = provisioner.id;
    await db()
      .update(runnerSessions)
      .set({registrationTokenKind: 'ephemeral', maxClaims: 1, provisionerId, providerRunnerId})
      .where(eq(runnerSessions.id, runnerSessionId));
    await db().insert(providerRunners).values({
      workspaceId,
      provisionerId,
      providerRunnerId,
      providerKind: 'ec2',
      launchKind: 'demand',
      templateKey: 'linux',
      labels: sessionLabels,
      state: 'running',
      reportedAt: new Date(),
    });
    const created = await pendingJobFactory.create({workspaceId});
    const recordQueueTime = vi.spyOn(runnerMetrics, 'recordJobExecutionQueueTime');

    try {
      await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: 1});

      const payload = runnerJobClaimedEventSchema
        .strict()
        .parse((await outboxEventsForJob(RUNNER_JOB_CLAIMED, created.jobId))[0]?.payload);
      expect(payload).toMatchObject({
        workspaceId,
        projectId: created.projectId,
        runnerLabels: sessionLabels,
        templateKey: 'linux',
        provisionerId,
        providerRunnerId,
        provisionerScope: scope,
        providerKind: 'ec2',
        launchKind: 'demand',
      });
      expect(recordQueueTime).toHaveBeenCalledWith(
        expect.objectContaining({provider: 'ec2', launchKind: 'demand'}),
      );
      expect(recordQueueTime.mock.calls[0]?.[0].durationMilliseconds).toBeGreaterThanOrEqual(0);
    } finally {
      recordQueueTime.mockRestore();
    }
  });

  it('emits no claimed event when there is nothing to claim', async () => {
    const recordQueueTime = vi.spyOn(runnerMetrics, 'recordJobExecutionQueueTime');
    const before = await db()
      .select()
      .from(runnersOutbox)
      .where(eq(runnersOutbox.eventType, RUNNER_JOB_CLAIMED));

    try {
      const claimed = await claimPendingJobExecution({
        workspaceId,
        runnerSessionId,
        maxClaims: null,
      });

      const after = await db()
        .select()
        .from(runnersOutbox)
        .where(eq(runnersOutbox.eventType, RUNNER_JOB_CLAIMED));
      expect(claimed).toBeNull();
      expect(after).toHaveLength(before.length);
      expect(recordQueueTime).not.toHaveBeenCalled();
    } finally {
      recordQueueTime.mockRestore();
    }
  });

  it('emits no claimed event when dropping an orphan pending row', async () => {
    const created = await pendingJobFactory.create({workspaceId});
    const first = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
    if (!first) throw new Error('Expected pending job to be claimed');
    await db().insert(pendingJobExecutions).values({
      workspaceId,
      workflowRunId: created.workflowRunId,
      jobId: created.jobId,
      jobExecutionId: first.jobExecutionId,
      workflowRunAttemptId: created.workflowRunAttemptId,
      projectId: created.projectId,
      requiredLabels: created.requiredLabels,
    });
    // Clear the initial claim's events so this assertion only covers the orphan claim.
    const beforeOrphanClaim = await outboxEventsForJob(RUNNER_JOB_CLAIMED, created.jobId);
    const recordQueueTime = vi.spyOn(runnerMetrics, 'recordJobExecutionQueueTime');

    try {
      const second = await claimPendingJobExecution({
        workspaceId,
        runnerSessionId,
        maxClaims: null,
      });

      expect(second).toBeNull();
      expect(await outboxEventsForJob(RUNNER_JOB_CLAIMED, created.jobId)).toHaveLength(
        beforeOrphanClaim.length,
      );
      expect(recordQueueTime).not.toHaveBeenCalled();
    } finally {
      recordQueueTime.mockRestore();
    }
  });

  it('returns the job ids when a job is available', async () => {
    const created = await pendingJobFactory.create({workspaceId});

    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});

    expect(claimed).not.toBeNull();
    expect(claimed?.jobId).toBe(created.jobId);
    expect(claimed?.workflowRunAttemptId).toBe(created.workflowRunAttemptId);
    expect(claimed?.projectId).toBe(created.projectId);
  });

  it('starts a claimed job without a first heartbeat marker', async () => {
    await pendingJobFactory.create({workspaceId});

    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});

    const [running] = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobExecutionId, claimed?.jobExecutionId as string));
    expect(running?.firstHeartbeatAt).toBeNull();
  });

  it('reports an active lease only for the session that claimed the job', async () => {
    const created = await pendingJobFactory.create({workspaceId});
    const otherRunnerSession = await runnerSessionFactory.create({workspaceId});

    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
    const active = await isJobLeaseActive({
      jobId: created.jobId,
      jobExecutionId: claimed?.jobExecutionId as string,
      runnerSessionId,
    });
    const stale = await isJobLeaseActive({
      jobId: created.jobId,
      jobExecutionId: created.jobExecutionId,
      runnerSessionId: otherRunnerSession.id,
    });
    const mismatchedJob = await isJobLeaseActive({
      jobId: crypto.randomUUID(),
      jobExecutionId: claimed?.jobExecutionId as string,
      runnerSessionId,
    });

    expect(active).toBe(true);
    expect(stale).toBe(false);
    expect(mismatchedJob).toBe(false);
  });

  it('returns null when no jobs are pending', async () => {
    await db()
      .update(runnerSessions)
      .set({updatedAt: new Date('2025-01-01T00:00:00.000Z')})
      .where(eq(runnerSessions.id, runnerSessionId));

    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});

    const [session] = await db()
      .select({updatedAt: runnerSessions.updatedAt})
      .from(runnerSessions)
      .where(eq(runnerSessions.id, runnerSessionId));
    expect(claimed).toBeNull();
    expect(session?.updatedAt.getTime()).toBeGreaterThan(
      new Date('2025-01-01T00:00:00.000Z').getTime(),
    );
  });

  it('touches runner session liveness when a job is claimed', async () => {
    const staleUpdatedAt = new Date('2025-01-01T00:00:00.000Z');
    await db()
      .update(runnerSessions)
      .set({updatedAt: staleUpdatedAt})
      .where(eq(runnerSessions.id, runnerSessionId));
    await pendingJobFactory.create({workspaceId});

    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});

    const [session] = await db()
      .select({updatedAt: runnerSessions.updatedAt})
      .from(runnerSessions)
      .where(eq(runnerSessions.id, runnerSessionId));
    expect(claimed).not.toBeNull();
    expect(session?.updatedAt.getTime()).toBeGreaterThan(staleUpdatedAt.getTime());
  });

  it('does not touch runner session liveness inside the throttle window', async () => {
    const freshUpdatedAt = new Date();
    await db()
      .update(runnerSessions)
      .set({updatedAt: freshUpdatedAt})
      .where(eq(runnerSessions.id, runnerSessionId));

    const claimed = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId,
      maxClaims: null,
      runnerSessionLivenessThrottleSeconds: 10,
    });

    const [session] = await db()
      .select({updatedAt: runnerSessions.updatedAt})
      .from(runnerSessions)
      .where(eq(runnerSessions.id, runnerSessionId));
    expect(claimed).toBeNull();
    expect(session?.updatedAt.getTime()).toBe(freshUpdatedAt.getTime());
  });

  it('enforces a non-null session claim cap from the database', async () => {
    const provisionerId = crypto.randomUUID();
    const providerRunnerId = `provisioned-runner-${crypto.randomUUID()}`;
    await db()
      .update(runnerSessions)
      .set({registrationTokenKind: 'ephemeral', maxClaims: 1, provisionerId, providerRunnerId})
      .where(eq(runnerSessions.id, runnerSessionId));
    await pendingJobFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});

    const first = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: 1});

    expect(first).not.toBeNull();
    await expect(
      claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: 1}),
    ).rejects.toBeInstanceOf(RunnerSessionExhaustedError);
  });

  it('does not spend a claim when a capped session polls an empty queue', async () => {
    const provisionerId = crypto.randomUUID();
    const providerRunnerId = `provisioned-runner-${crypto.randomUUID()}`;
    const runnerInstanceId = crypto.randomUUID();
    await db()
      .update(runnerSessions)
      .set({registrationTokenKind: 'ephemeral', maxClaims: 1, provisionerId, providerRunnerId})
      .where(eq(runnerSessions.id, runnerSessionId));
    await db().insert(providerRunners).values({
      id: runnerInstanceId,
      workspaceId,
      provisionerId,
      providerRunnerId,
      labels: sessionLabels,
      state: 'running',
      reportedAt: new Date(),
    });

    const empty = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: 1});

    const [afterEmpty] = await db()
      .select({claimsUsed: runnerSessions.claimsUsed})
      .from(runnerSessions)
      .where(eq(runnerSessions.id, runnerSessionId));
    expect(empty).toBeNull();
    expect(afterEmpty?.claimsUsed).toBe(0);

    const created = await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: 1});

    const [afterClaim] = await db()
      .select({claimsUsed: runnerSessions.claimsUsed})
      .from(runnerSessions)
      .where(eq(runnerSessions.id, runnerSessionId));
    expect(claimed?.jobId).toBe(created.jobId);
    expect(afterClaim?.claimsUsed).toBe(1);

    const [runner] = await db()
      .select({firstClaimedAt: providerRunners.firstClaimedAt})
      .from(providerRunners)
      .where(eq(providerRunners.id, runnerInstanceId));
    expect(runner?.firstClaimedAt).toBeInstanceOf(Date);
  });

  it('clears stale termination authorization when a provisioned runner claims a new job', async () => {
    const provisionerId = crypto.randomUUID();
    const providerRunnerId = `provisioned-runner-${crypto.randomUUID()}`;
    const authorizedAt = new Date('2026-01-01T00:00:00.000Z');
    const runner = await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId,
      runnerSessionId,
      state: 'running',
      labels: sessionLabels,
      terminationAuthorizedAt: authorizedAt,
      terminationReason: 'job-cancelled',
    });
    await db()
      .update(runnerSessions)
      .set({registrationTokenKind: 'ephemeral', maxClaims: 1, provisionerId, providerRunnerId})
      .where(eq(runnerSessions.id, runnerSessionId));
    await pendingJobFactory.create({workspaceId});

    await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: 1});

    const [afterClaim] = await db()
      .select({
        terminationAuthorizedAt: providerRunners.terminationAuthorizedAt,
        terminationReason: providerRunners.terminationReason,
      })
      .from(providerRunners)
      .where(eq(providerRunners.id, runner.id));
    expect(afterClaim).toEqual({terminationAuthorizedAt: null, terminationReason: null});
  });

  it('releases a provisioned runner reservation on its first claim only', async () => {
    const reservationReleaseMetric = vi.spyOn(runnerMetrics.reservationReleasedCount, 'add');
    try {
      const provisionerId = crypto.randomUUID();
      const providerRunnerId = `provisioned-runner-${crypto.randomUUID()}`;
      const [reservation] = await db()
        .insert(reservations)
        .values({
          workspaceId,
          provisionerId,
          requiredLabels: sessionLabels,
          count: 2,
          expiresAt: new Date(Date.now() + 60_000),
        })
        .returning({id: reservations.id});
      if (!reservation) throw new Error('Expected reservation');

      const runner = await providerRunnerFactory.create({
        workspaceId,
        provisionerId,
        providerRunnerId,
        reservationId: reservation.id,
        runnerSessionId,
        state: 'running',
        labels: sessionLabels,
      });
      await db()
        .update(runnerSessions)
        .set({
          registrationTokenKind: 'ephemeral',
          maxClaims: 2,
          provisionerId,
          providerRunnerId,
        })
        .where(eq(runnerSessions.id, runnerSessionId));

      const firstPending = await pendingJobFactory.create({workspaceId});
      const firstClaim = await claimPendingJobExecution({
        workspaceId,
        runnerSessionId,
        maxClaims: 2,
      });
      const [afterFirstClaim] = await db()
        .select({count: reservations.count})
        .from(reservations)
        .where(eq(reservations.id, reservation.id));
      const [runnerAfterFirstClaim] = await db()
        .select({reservationReleasedAt: providerRunners.reservationReleasedAt})
        .from(providerRunners)
        .where(eq(providerRunners.id, runner.id));
      const firstReleaseAt = runnerAfterFirstClaim?.reservationReleasedAt;

      const secondPending = await pendingJobFactory.create({workspaceId});
      const secondClaim = await claimPendingJobExecution({
        workspaceId,
        runnerSessionId,
        maxClaims: 2,
      });
      const [afterSecondClaim] = await db()
        .select({count: reservations.count})
        .from(reservations)
        .where(eq(reservations.id, reservation.id));
      const [runnerAfterSecondClaim] = await db()
        .select({reservationReleasedAt: providerRunners.reservationReleasedAt})
        .from(providerRunners)
        .where(eq(providerRunners.id, runner.id));

      expect(firstClaim?.jobExecutionId).toBe(firstPending.jobExecutionId);
      expect(afterFirstClaim?.count).toBe(1);
      expect(firstReleaseAt).toBeInstanceOf(Date);
      expect(
        reservationReleaseMetric.mock.calls.filter(
          ([value, attributes]) => value === 1 && attributes?.surface === 'first-claim',
        ),
      ).toHaveLength(1);
      expect(secondClaim?.jobExecutionId).toBe(secondPending.jobExecutionId);
      expect(afterSecondClaim?.count).toBe(1);
      expect(runnerAfterSecondClaim?.reservationReleasedAt).toEqual(firstReleaseAt);
    } finally {
      reservationReleaseMetric.mockRestore();
    }
  });

  it('allows a manual session to claim repeatedly', async () => {
    const first = await pendingJobFactory.create({workspaceId});
    const second = await pendingJobFactory.create({workspaceId});

    const firstClaim = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId,
      maxClaims: null,
    });
    const secondClaim = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId,
      maxClaims: null,
    });

    expect(firstClaim?.jobId).toBe(first.jobId);
    expect(secondClaim?.jobId).toBe(second.jobId);
  });

  it('only one caller wins when two claim concurrently', async () => {
    const otherRunnerSession = await runnerSessionFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});

    const [claim1, claim2] = await Promise.all([
      claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null}),
      claimPendingJobExecution({
        workspaceId,
        runnerSessionId: otherRunnerSession.id,
        maxClaims: null,
      }),
    ]);

    const claimed = [claim1, claim2].filter(Boolean);
    expect(claimed).toHaveLength(1);
  });

  it('locks only the FIFO candidate before acquiring its execution advisory lock', async () => {
    const first = await pendingJobFactory.create({workspaceId});
    const second = await pendingJobFactory.create({workspaceId});
    const releaseLock = deferred<void>();
    const lockReady = deferred<void>();
    const lockHolder = db().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`runners_job_execution:${first.jobExecutionId}`}))`,
      );
      lockReady.resolve();
      await releaseLock.promise;
    });

    try {
      await lockReady.promise;
      expect(
        await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null}),
      ).toBeNull();
      expect(
        await db()
          .select()
          .from(pendingJobExecutions)
          .where(eq(pendingJobExecutions.workspaceId, workspaceId)),
      ).toHaveLength(2);
    } finally {
      releaseLock.resolve();
      await lockHolder;
    }

    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
    expect(claimed?.jobExecutionId).toBe(first.jobExecutionId);
    expect(second.jobExecutionId).not.toBe(claimed?.jobExecutionId);
  });

  it('claims the oldest job first', async () => {
    const older = await pendingJobFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});

    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});

    expect(claimed?.jobId).toBe(older.jobId);
  });

  it('moves the job from pending to running', async () => {
    const created = await pendingJobFactory.create({workspaceId});

    await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});

    const pending = await db()
      .select()
      .from(pendingJobExecutions)
      .where(eq(pendingJobExecutions.workspaceId, workspaceId));
    const running = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.workspaceId, workspaceId));
    expect(pending).toHaveLength(0);
    expect(running).toHaveLength(1);
    expect(running[0]?.runnerSessionId).toBe(runnerSessionId);
    expect(running[0]?.projectId).toBe(created.projectId);
    expect(running[0]?.requiredLabels).toEqual(created.requiredLabels);
    expect(running[0]?.runnerLabels).toEqual(sessionLabels);
    expect(running[0]?.provisionerId).toBeNull();
    expect(running[0]?.providerRunnerId).toBeNull();
  });

  it('copies an ephemeral session provisioned-runner link onto the running job', async () => {
    const provisionerId = crypto.randomUUID();
    const providerRunnerId = `provisioned-runner-${crypto.randomUUID()}`;
    await db()
      .update(runnerSessions)
      .set({registrationTokenKind: 'ephemeral', maxClaims: 1, provisionerId, providerRunnerId})
      .where(eq(runnerSessions.id, runnerSessionId));
    const created = await pendingJobFactory.create({workspaceId});

    await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: 1});

    const [running] = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, created.jobId));
    expect(running?.provisionerId).toBe(provisionerId);
    expect(running?.providerRunnerId).toBe(providerRunnerId);
  });

  it('rejects a running job row with a partial provisioned-runner link', async () => {
    const created = await pendingJobFactory.create({workspaceId});

    await expect(
      db().insert(runningJobExecutions).values({
        workspaceId,
        workflowRunId: created.workflowRunId,
        jobId: created.jobId,
        jobExecutionId: created.jobExecutionId,
        workflowRunAttemptId: created.workflowRunAttemptId,
        projectId: created.projectId,
        runnerSessionId,
        provisionerId: crypto.randomUUID(),
        requiredLabels: created.requiredLabels,
        runnerLabels: sessionLabels,
      }),
    ).rejects.toThrow();
  });

  it('claims a job whose required labels are a subset of the session labels', async () => {
    const created = await pendingJobFactory.create({
      workspaceId,
      requiredLabels: ['linux'],
    });

    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId});

    expect(claimed?.jobId).toBe(created.jobId);
  });

  it('claims a job whose required labels exactly match the session labels', async () => {
    const created = await pendingJobFactory.create({
      workspaceId,
      requiredLabels: ['linux', 'x64'],
    });

    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId});

    expect(claimed?.jobId).toBe(created.jobId);
  });

  it('claims by labels only when runner tool capabilities differ', async () => {
    const matchingRunner = await runnerSessionFactory.create({
      workspaceId,
      labels: sessionLabels,
      toolCapabilities: {harnesses: {pi: {tools: ['read']}}},
    });
    const underRunnerInstance = await runnerSessionFactory.create({
      workspaceId,
      labels: sessionLabels,
      toolCapabilities: {harnesses: {pi: {tools: []}}},
    });
    const firstJob = await pendingJobFactory.create({
      workspaceId,
      requiredLabels: ['linux'],
    });
    const secondJob = await pendingJobFactory.create({
      workspaceId,
      requiredLabels: ['linux'],
    });

    const firstClaim = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId: underRunnerInstance.id,
    });
    const secondClaim = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId: matchingRunner.id,
    });

    expect([firstClaim?.jobId, secondClaim?.jobId].sort()).toEqual(
      [firstJob.jobId, secondJob.jobId].sort(),
    );
  });

  it('skips an older incompatible job and claims the oldest compatible job', async () => {
    await pendingJobFactory.create({workspaceId, requiredLabels: ['macos']});
    const compatible = await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});
    await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});

    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId});

    expect(claimed?.jobId).toBe(compatible.jobId);
  });

  it('claims the older matching job before newer matching jobs', async () => {
    await pendingJobFactory.create({workspaceId, requiredLabels: ['macos']});
    const olderMatching = await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});
    await pendingJobFactory.create({workspaceId, requiredLabels: ['x64']});

    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId});

    expect(claimed?.jobId).toBe(olderMatching.jobId);
  });

  it('returns null when no compatible job is pending', async () => {
    await pendingJobFactory.create({workspaceId, requiredLabels: ['macos']});

    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId});

    expect(claimed).toBeNull();
  });

  it('returns null for an empty session label set', async () => {
    await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});

    const claimed = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId,
      sessionLabels: [],
    });

    expect(claimed).toBeNull();
  });

  it('claims the compatible row from a mixed-label queue', async () => {
    for (let index = 0; index < 8; index += 1) {
      await pendingJobFactory.create({workspaceId, requiredLabels: [`gpu-${index}`]});
    }
    const compatible = await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});

    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId});

    expect(claimed?.jobId).toBe(compatible.jobId);
  });

  it('does not claim jobs from another workspace', async () => {
    await pendingJobFactory.create({workspaceId: crypto.randomUUID()});

    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});

    expect(claimed).toBeNull();
  });

  it('drops an orphan pending row whose job is already running, without a poison loop', async () => {
    const created = await pendingJobFactory.create({workspaceId});
    const first = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
    if (!first) throw new Error('Expected pending job to be claimed');
    expect(first.jobId).toBe(created.jobId);

    // Simulate an enqueue retry that re-inserts a pending row after the claim.
    await db().insert(pendingJobExecutions).values({
      workspaceId,
      workflowRunId: created.workflowRunId,
      jobId: created.jobId,
      jobExecutionId: first.jobExecutionId,
      workflowRunAttemptId: created.workflowRunAttemptId,
      projectId: created.projectId,
      requiredLabels: created.requiredLabels,
    });

    const second = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});

    expect(second).toBeNull();
    expect(
      await db()
        .select()
        .from(pendingJobExecutions)
        .where(eq(pendingJobExecutions.workspaceId, workspaceId)),
    ).toHaveLength(0);
    const running = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.workspaceId, workspaceId));
    expect(running).toHaveLength(1);
    expect(running[0]?.jobId).toBe(created.jobId);
  });

  it('sweeps a non-matching orphan when terminal reconciliation removes the execution', async () => {
    const created = await pendingJobFactory.create({workspaceId});
    const first = await claimPendingJobExecution({workspaceId, runnerSessionId});
    if (!first) throw new Error('Expected pending job to be claimed');
    expect(first.jobId).toBe(created.jobId);
    await db().insert(pendingJobExecutions).values({
      workspaceId,
      workflowRunId: created.workflowRunId,
      jobId: created.jobId,
      jobExecutionId: first.jobExecutionId,
      workflowRunAttemptId: created.workflowRunAttemptId,
      projectId: created.projectId,
      requiredLabels: created.requiredLabels,
    });

    const second = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId,
      sessionLabels: ['macos'],
    });
    await reconcileTerminalJobExecution({
      jobExecutionId: created.jobExecutionId,
      cancellationReason: null,
    });

    expect(second).toBeNull();
    const running = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.workspaceId, workspaceId));
    expect(running).toHaveLength(0);
    expect(
      await db()
        .select()
        .from(pendingJobExecutions)
        .where(eq(pendingJobExecutions.workspaceId, workspaceId)),
    ).toHaveLength(0);
  });

  it('claims a real pending job ahead of a newer orphan', async () => {
    const alreadyRunning = await pendingJobFactory.create({workspaceId});
    const first = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
    if (!first) throw new Error('Expected pending job to be claimed');

    // A genuinely new pending job (older), then an orphan re-insert for the running job (newer).
    const real = await pendingJobFactory.create({workspaceId});
    await db().insert(pendingJobExecutions).values({
      workspaceId,
      workflowRunId: alreadyRunning.workflowRunId,
      jobId: alreadyRunning.jobId,
      jobExecutionId: first.jobExecutionId,
      workflowRunAttemptId: alreadyRunning.workflowRunAttemptId,
      projectId: alreadyRunning.projectId,
      requiredLabels: alreadyRunning.requiredLabels,
    });

    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});

    expect(claimed?.jobId).toBe(real.jobId);
  });
});

describe('claimJobExecution', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  it('mints a lease token whose claims match the claimed job', async () => {
    const created = await pendingJobFactory.create({workspaceId});

    const claimed = await claimJobExecution({
      auth: runnersTestAuthClient,
      workspaceId,
      runnerSessionId,
      sessionLabels,
      maxClaims: null,
    });

    expect(claimed).not.toBeNull();
    expect(claimed?.jobId).toBe(created.jobId);
    expect(claimed?.workflowRunAttemptId).toBe(created.workflowRunAttemptId);
    expect(claimed).not.toHaveProperty('steps');

    const claims = getLeaseTokenClaims(claimed?.leaseToken as string);
    expect(claims).toMatchObject({
      jobId: created.jobId,
      workflowRunAttemptId: created.workflowRunAttemptId,
      projectId: created.projectId,
      workspaceId,
      runnerSessionId,
    });
  });

  it('returns null and mints no token when the queue is empty', async () => {
    const claimed = await claimJobExecution({
      auth: runnersTestAuthClient,
      workspaceId,
      runnerSessionId,
      sessionLabels,
      maxClaims: null,
    });

    expect(claimed).toBeNull();
  });
});

describe('recordHeartbeat', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  it('returns cancel:false on a fresh row and records the first heartbeat', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});

    const before = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    // Force last_heartbeat_at into the past so we can observe the update.
    await db()
      .update(runningJobExecutions)
      .set({lastHeartbeatAt: sql`now() - interval '1 hour'`})
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));

    const result = await recordHeartbeat({
      jobExecutionId: claimed?.jobExecutionId as string,
      runnerSessionId,
    });

    expect(result).toMatchObject({
      cancellationRequested: false,
      runningJobExecution: {
        jobId: claimed?.jobId,
        jobExecutionId: claimed?.jobExecutionId,
        runnerSessionId,
      },
    });

    const after = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    expect(after[0]?.firstHeartbeatAt).toBeInstanceOf(Date);
    expect(after[0]?.lastHeartbeatAt.getTime()).toBeGreaterThan(
      (before[0]?.lastHeartbeatAt.getTime() ?? 0) - 1,
    );
  });

  it('preserves first_heartbeat_at on later heartbeats', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
    await recordHeartbeat({
      jobExecutionId: claimed?.jobExecutionId as string,
      runnerSessionId,
    });
    const [afterFirst] = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    await db()
      .update(runningJobExecutions)
      .set({lastHeartbeatAt: sql`now() - interval '1 hour'`})
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));

    await recordHeartbeat({
      jobExecutionId: claimed?.jobExecutionId as string,
      runnerSessionId,
    });

    const [afterSecond] = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    expect(afterSecond?.firstHeartbeatAt?.getTime()).toBe(afterFirst?.firstHeartbeatAt?.getTime());
    expect(afterSecond?.lastHeartbeatAt.getTime()).toBeGreaterThan(
      afterFirst?.firstHeartbeatAt?.getTime() ?? 0,
    );
  });

  it('returns cancel:true after a stop handoff is recorded by reconciliation', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});

    await reconcileTerminalJobExecution({
      jobExecutionId: claimed?.jobExecutionId as string,
      cancellationReason: 'run_cancelled',
    });

    const result = await recordHeartbeat({
      jobExecutionId: claimed?.jobExecutionId as string,
      runnerSessionId,
    });

    expect(result).toMatchObject({
      cancellationRequested: true,
      runningJobExecution: {
        jobId: claimed?.jobId,
        jobExecutionId: claimed?.jobExecutionId,
        runnerSessionId,
      },
    });
    expect(
      await db()
        .select()
        .from(runningJobExecutions)
        .where(eq(runningJobExecutions.jobExecutionId, claimed?.jobExecutionId as string)),
    ).toHaveLength(0);
  });

  it('keeps a managed stop handoff until provider termination or cleanup grace', async () => {
    const provisionerId = crypto.randomUUID();
    const providerRunnerId = crypto.randomUUID();
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId,
      state: 'running',
    });
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
    expect(claimed?.jobExecutionId).toBeDefined();
    await db()
      .update(runningJobExecutions)
      .set({provisionerId, providerRunnerId})
      .where(eq(runningJobExecutions.jobExecutionId, claimed?.jobExecutionId as string));

    await reconcileTerminalJobExecution({
      jobExecutionId: claimed?.jobExecutionId as string,
      cancellationReason: 'run_cancelled',
    });

    const result = await recordHeartbeat({
      jobExecutionId: claimed?.jobExecutionId as string,
      runnerSessionId,
    });

    expect(result).toMatchObject({cancellationRequested: true});
    const [handoff] = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobExecutionId, claimed?.jobExecutionId as string));
    expect(handoff?.cancellationReason).toBe('run_cancelled');
  });

  it('throws RunningJobExecutionNotFoundError when jobId is unknown', async () => {
    await expect(
      recordHeartbeat({jobExecutionId: crypto.randomUUID(), runnerSessionId}),
    ).rejects.toThrow('Running job execution not found');
  });

  it('throws when jobId belongs to a different session', async () => {
    const otherRunnerSession = await runnerSessionFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});

    await expect(
      recordHeartbeat({
        jobExecutionId: claimed?.jobExecutionId as string,
        runnerSessionId: otherRunnerSession.id,
      }),
    ).rejects.toThrow('Running job execution not found');
  });
});

describe('reconcileTerminalJobExecution', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  it('deletes a pending execution', async () => {
    const pending = await pendingJobFactory.create({workspaceId});

    await reconcileTerminalJobExecution({jobExecutionId: pending.jobExecutionId});

    expect(
      await db()
        .select()
        .from(pendingJobExecutions)
        .where(eq(pendingJobExecutions.jobExecutionId, pending.jobExecutionId)),
    ).toHaveLength(0);
  });

  it('sets cancellation_requested_at on a running execution', async () => {
    const pending = await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
    expect(claimed?.jobExecutionId).toBe(pending.jobExecutionId);

    await reconcileTerminalJobExecution({
      jobExecutionId: pending.jobExecutionId,
      cancellationReason: 'timed_out',
    });

    const rows = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobExecutionId, pending.jobExecutionId));
    expect(rows[0]?.cancellationRequestedAt).not.toBeNull();
    expect(rows[0]?.cancellationReason).toBe('timed_out');
  });

  it('deletes a normal terminal lease without double-releasing a terminal runner reservation', async () => {
    const provisionerId = crypto.randomUUID();
    const providerRunnerId = crypto.randomUUID();
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId,
        provisionerId,
        requiredLabels: sessionLabels,
        count: 2,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning({id: reservations.id});
    if (!reservation) throw new Error('Expected reservation');
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId,
      reservationId: reservation.id,
      runnerSessionId,
      state: 'running',
    });
    await db()
      .update(runnerSessions)
      .set({registrationTokenKind: 'ephemeral', maxClaims: 1, provisionerId, providerRunnerId})
      .where(eq(runnerSessions.id, runnerSessionId));
    const pending = await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: 1});
    expect(claimed?.jobExecutionId).toBe(pending.jobExecutionId);
    const [afterClaim] = await db()
      .select({count: reservations.count})
      .from(reservations)
      .where(eq(reservations.id, reservation.id));
    const [runnerAfterClaim] = await db()
      .select({reservationReleasedAt: providerRunners.reservationReleasedAt})
      .from(providerRunners)
      .where(eq(providerRunners.providerRunnerId, providerRunnerId));
    expect(afterClaim?.count).toBe(1);
    expect(runnerAfterClaim?.reservationReleasedAt).toBeInstanceOf(Date);
    await db()
      .update(providerRunners)
      .set({state: 'terminated', terminatedAt: new Date()})
      .where(eq(providerRunners.providerRunnerId, providerRunnerId));
    await db()
      .update(runningJobExecutions)
      .set({provisionerId, providerRunnerId})
      .where(eq(runningJobExecutions.jobExecutionId, pending.jobExecutionId));

    await reconcileTerminalJobExecution({jobExecutionId: pending.jobExecutionId});

    const [afterTerminal] = await db()
      .select({count: reservations.count})
      .from(reservations)
      .where(eq(reservations.id, reservation.id));
    expect(afterTerminal?.count).toBe(1);
    expect(
      await db()
        .select()
        .from(runningJobExecutions)
        .where(eq(runningJobExecutions.jobExecutionId, pending.jobExecutionId)),
    ).toHaveLength(0);
    const [runner] = await db()
      .select({reservationReleasedAt: providerRunners.reservationReleasedAt})
      .from(providerRunners)
      .where(eq(providerRunners.providerRunnerId, providerRunnerId));
    expect(runner?.reservationReleasedAt).toBeInstanceOf(Date);
  });

  it('is idempotent: second call preserves the first timestamp', async () => {
    const pending = await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
    expect(claimed?.jobExecutionId).toBe(pending.jobExecutionId);

    await reconcileTerminalJobExecution({
      jobExecutionId: pending.jobExecutionId,
      cancellationReason: 'timed_out',
    });
    const after1 = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobExecutionId, pending.jobExecutionId));
    const firstTs = after1[0]?.cancellationRequestedAt;

    await new Promise((r) => setTimeout(r, 10));
    await reconcileTerminalJobExecution({
      jobExecutionId: pending.jobExecutionId,
      cancellationReason: 'timed_out',
    });

    const after2 = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobExecutionId, pending.jobExecutionId));
    expect(after2[0]?.cancellationRequestedAt?.getTime()).toBe(firstTs?.getTime());
  });

  it('preserves an existing stop handoff when a duplicate terminal event has no stop reason', async () => {
    const pending = await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
    expect(claimed?.jobExecutionId).toBe(pending.jobExecutionId);

    await reconcileTerminalJobExecution({
      jobExecutionId: pending.jobExecutionId,
      cancellationReason: 'timed_out',
    });
    const [beforeDuplicate] = await db()
      .select({cancellationRequestedAt: runningJobExecutions.cancellationRequestedAt})
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobExecutionId, pending.jobExecutionId));

    await reconcileTerminalJobExecution({
      jobExecutionId: pending.jobExecutionId,
      cancellationReason: null,
    });

    const [afterDuplicate] = await db()
      .select({
        cancellationRequestedAt: runningJobExecutions.cancellationRequestedAt,
        cancellationReason: runningJobExecutions.cancellationReason,
      })
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobExecutionId, pending.jobExecutionId));
    expect(afterDuplicate?.cancellationRequestedAt?.getTime()).toBe(
      beforeDuplicate?.cancellationRequestedAt?.getTime(),
    );
    expect(afterDuplicate?.cancellationReason).toBe('timed_out');
  });

  it('is a no-op when the job execution is missing', async () => {
    await expect(
      reconcileTerminalJobExecution({jobExecutionId: crypto.randomUUID()}),
    ).resolves.toBeUndefined();
  });

  it('takes the execution lock before rechecking a missing job execution', async () => {
    const jobExecutionId = crypto.randomUUID();
    const releaseLock = deferred<void>();
    const lockReady = deferred<void>();
    const lockHolder = db().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`runners_job_execution:${jobExecutionId}`}))`,
      );
      lockReady.resolve();
      await releaseLock.promise;
    });

    await lockReady.promise;
    const reconciliation = reconcileTerminalJobExecution({jobExecutionId});
    try {
      await waitForLockWait({queryLike: '%pg_advisory_xact_lock%'});
    } finally {
      releaseLock.resolve();
    }

    await expect(reconciliation).resolves.toBeUndefined();
    await lockHolder;
  });

  it('leaves a pending sibling for the same job untouched', async () => {
    const target = await pendingJobFactory.create({workspaceId});
    const sibling = await pendingJobFactory.create({workspaceId, jobId: target.jobId});

    await reconcileTerminalJobExecution({jobExecutionId: target.jobExecutionId});

    expect(
      await db()
        .select()
        .from(pendingJobExecutions)
        .where(eq(pendingJobExecutions.jobExecutionId, target.jobExecutionId)),
    ).toHaveLength(0);
    expect(
      await db()
        .select()
        .from(pendingJobExecutions)
        .where(eq(pendingJobExecutions.jobExecutionId, sibling.jobExecutionId)),
    ).toHaveLength(1);
  });

  it('leaves a running sibling for the same job uncancelled', async () => {
    const target = await pendingJobFactory.create({workspaceId});
    const sibling = await pendingJobFactory.create({workspaceId, jobId: target.jobId});
    const targetClaim = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId,
      maxClaims: null,
    });
    const siblingClaim = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId,
      maxClaims: null,
    });
    expect(targetClaim?.jobExecutionId).toBe(target.jobExecutionId);
    expect(siblingClaim?.jobExecutionId).toBe(sibling.jobExecutionId);

    await reconcileTerminalJobExecution({jobExecutionId: target.jobExecutionId});

    const rows = await db()
      .select({
        jobExecutionId: runningJobExecutions.jobExecutionId,
        cancellationRequestedAt: runningJobExecutions.cancellationRequestedAt,
      })
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, target.jobId));
    const byJobExecutionId = new Map(
      rows.map((row) => [row.jobExecutionId, row.cancellationRequestedAt]),
    );
    expect(byJobExecutionId.has(target.jobExecutionId)).toBe(false);
    expect(byJobExecutionId.get(sibling.jobExecutionId)).toBeNull();
  });

  it('cancels the lease when reconciliation races a claim that has already acquired the row', async () => {
    const pending = await pendingJobFactory.create({workspaceId});
    const releaseClaim = deferred<void>();
    const claimTransactionReady = deferred<void>();
    const lockHolder = db().transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE runners_outbox IN ACCESS EXCLUSIVE MODE`);
      claimTransactionReady.resolve();
      await releaseClaim.promise;
    });

    let claim: ReturnType<typeof claimPendingJobExecution> | undefined;
    let reconciliation: Promise<void> | undefined;
    try {
      await claimTransactionReady.promise;
      claim = claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
      await waitForLockWait({queryLike: '%runners_outbox%'});

      reconciliation = reconcileTerminalJobExecution({jobExecutionId: pending.jobExecutionId});
      // Claim has already deleted the pending row and inserted the lease, but cannot commit its
      // outbox event while the table lock is held. Reconciliation must wait on that same claim's
      // execution advisory lock.
      await waitForLockWait({queryLike: '%pg_advisory_xact_lock%'});
    } finally {
      releaseClaim.resolve();
      await Promise.allSettled([
        lockHolder,
        claim ?? Promise.resolve(null),
        reconciliation ?? Promise.resolve(),
      ]);
    }

    if (!claim || !reconciliation) throw new Error('Claim and reconciliation must both start');
    const [claimed] = await Promise.all([claim, reconciliation, lockHolder]);
    expect(claimed?.jobExecutionId).toBe(pending.jobExecutionId);

    expect(
      await db()
        .select()
        .from(pendingJobExecutions)
        .where(eq(pendingJobExecutions.jobExecutionId, pending.jobExecutionId)),
    ).toHaveLength(0);
    const runningRows = await db()
      .select({cancellationRequestedAt: runningJobExecutions.cancellationRequestedAt})
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobExecutionId, pending.jobExecutionId));
    expect(runningRows).toHaveLength(0);
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

async function waitForLockWait(params: {queryLike: string}) {
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
          AND query ILIKE $1
      `,
      [params.queryLike],
    );
    if ((result.rows[0]?.count ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for lock waiter matching ${params.queryLike}`);
}

describe('detectAndExpireStuckJobs', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  async function makeStaleJob(staleSeconds: number): Promise<{
    jobId: string;
    jobExecutionId: string;
    workflowRunId: string;
    workflowRunAttemptId: string;
    projectId: string;
  }> {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
    await db()
      .update(runningJobExecutions)
      .set({
        firstHeartbeatAt: sql`now() - (${staleSeconds} || ' seconds')::interval`,
        lastHeartbeatAt: sql`now() - (${staleSeconds} || ' seconds')::interval`,
      })
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    return {
      jobId: claimed?.jobId as string,
      jobExecutionId: claimed?.jobExecutionId as string,
      workflowRunId: claimed?.workflowRunId as string,
      workflowRunAttemptId: claimed?.workflowRunAttemptId as string,
      projectId: claimed?.projectId as string,
    };
  }

  async function makeNoFirstHeartbeatJob(ageSeconds: number): Promise<{
    jobId: string;
    jobExecutionId: string;
    workflowRunId: string;
    workflowRunAttemptId: string;
    projectId: string;
  }> {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
    await db()
      .update(runningJobExecutions)
      .set({
        startedAt: sql`now() - (${ageSeconds} || ' seconds')::interval`,
        lastHeartbeatAt: sql`now() - (${ageSeconds} || ' seconds')::interval`,
      })
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    return {
      jobId: claimed?.jobId as string,
      jobExecutionId: claimed?.jobExecutionId as string,
      workflowRunId: claimed?.workflowRunId as string,
      workflowRunAttemptId: claimed?.workflowRunAttemptId as string,
      projectId: claimed?.projectId as string,
    };
  }

  async function runningJobsForTest() {
    return await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.workspaceId, workspaceId));
  }

  async function outboxForJobs(jobIds: string[]) {
    const all = await db().select().from(runnersOutbox);
    return all.filter((row) => {
      // The same job ids can also have queued and claimed events from setup.
      if (row.eventType !== RUNNER_JOB_LEASE_EXPIRED) return false;
      const payload = row.payload as {jobId?: string};
      return payload.jobId !== undefined && jobIds.includes(payload.jobId);
    });
  }

  it('expires a stuck job and writes a runners.job.lease_expired event', async () => {
    const {jobId, workflowRunId, workflowRunAttemptId} = await makeStaleJob(600);

    const result = await detectAndExpireStuckJobs({thresholdSeconds: 180});

    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(await runningJobsForTest()).toHaveLength(0);

    const outbox = await outboxForJobs([jobId]);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.eventType).toBe(RUNNER_JOB_LEASE_EXPIRED);
    const payload = runnerJobLeaseExpiredEventSchema.strict().parse(outbox[0]?.payload);
    expect(payload.jobId).toBe(jobId);
    expect(payload.workflowRunId).toBe(workflowRunId);
    expect(payload.workflowRunAttemptId).toBe(workflowRunAttemptId);
    expect(payload.expiredAt).toEqual(expect.any(String));
    expect(new Date(payload.expiredAt as string).getTime()).toBeLessThan(Date.now() - 180_000);
    // The lease-expired event carries only the assignment identifiers and expiry timestamp.
    expect((payload as Record<string, unknown>).status).toBeUndefined();
    expect((payload as Record<string, unknown>).steps).toBeUndefined();
  });

  it('defers a correlated stale batch and recovers it with the operator override', async () => {
    const staleJobs = [await makeStaleJob(600), await makeStaleJob(600), await makeStaleJob(600)];

    // Any non-zero stale proportion meets this threshold; the minimum stale count
    // still keeps the scenario specific to a correlated batch.
    const deferred = await expireStuckJobExecutions({
      thresholdSeconds: 180,
      noFirstHeartbeatGraceSeconds: 60,
      correlatedStaleMinCount: 3,
      correlatedStaleRatio: Number.MIN_VALUE,
      correlatedStaleMode: 'defer',
    });

    expect(deferred).toHaveLength(0);
    expect(await runningJobsForTest()).toHaveLength(3);

    const recovered = await expireStuckJobExecutions({
      thresholdSeconds: 180,
      noFirstHeartbeatGraceSeconds: 60,
      correlatedStaleMinCount: 3,
      correlatedStaleRatio: Number.MIN_VALUE,
      correlatedStaleOverride: true,
    });

    expect(recovered).toHaveLength(3);
    expect(await runningJobsForTest()).toHaveLength(0);
    expect(await outboxForJobs(staleJobs.map(({jobId}) => jobId))).toHaveLength(3);
  });

  it('counts only uncancelled leases for the correlated stale breaker', async () => {
    const staleJobs = [await makeStaleJob(600), await makeStaleJob(600), await makeStaleJob(600)];
    const stopHandoffs = [
      await makeStaleJob(600),
      await makeStaleJob(600),
      await makeStaleJob(600),
    ];
    await db()
      .update(runningJobExecutions)
      .set({
        cancellationRequestedAt: new Date(),
        cancellationReason: 'run_cancelled',
      })
      .where(
        inArray(
          runningJobExecutions.jobExecutionId,
          stopHandoffs.map(({jobExecutionId}) => jobExecutionId),
        ),
      );

    const deferred = await expireStuckJobExecutions({
      thresholdSeconds: 180,
      noFirstHeartbeatGraceSeconds: 60,
      correlatedStaleMinCount: 3,
      correlatedStaleRatio: Number.MIN_VALUE,
      correlatedStaleMode: 'defer',
    });

    expect(deferred).toHaveLength(0);
    expect(await outboxForJobs(staleJobs.map(({jobId}) => jobId))).toHaveLength(0);
    expect(await outboxForJobs(stopHandoffs.map(({jobId}) => jobId))).toHaveLength(0);

    const recovered = await expireStuckJobExecutions({
      thresholdSeconds: 180,
      noFirstHeartbeatGraceSeconds: 60,
      correlatedStaleMinCount: 3,
      correlatedStaleRatio: Number.MIN_VALUE,
      correlatedStaleOverride: true,
    });

    expect(recovered.map(({jobExecutionId}) => jobExecutionId)).toEqual(
      expect.arrayContaining(staleJobs.map(({jobExecutionId}) => jobExecutionId)),
    );
    expect(await outboxForJobs(staleJobs.map(({jobId}) => jobId))).toHaveLength(3);
    expect(
      await db()
        .select()
        .from(runningJobExecutions)
        .where(
          inArray(
            runningJobExecutions.jobExecutionId,
            stopHandoffs.map(({jobExecutionId}) => jobExecutionId),
          ),
        ),
    ).toHaveLength(3);
  });

  it('cleans an expired manual stop handoff without emitting lease expiry', async () => {
    const pending = await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
    expect(claimed?.jobExecutionId).toBe(pending.jobExecutionId);

    await reconcileTerminalJobExecution({
      jobExecutionId: pending.jobExecutionId,
      cancellationReason: 'run_cancelled',
    });
    await db()
      .update(runningJobExecutions)
      .set({cancellationRequestedAt: new Date(Date.now() - 300_000)})
      .where(eq(runningJobExecutions.jobExecutionId, pending.jobExecutionId));

    await detectAndExpireStuckJobs({thresholdSeconds: 180});

    expect(
      await db()
        .select()
        .from(runningJobExecutions)
        .where(eq(runningJobExecutions.jobExecutionId, pending.jobExecutionId)),
    ).toHaveLength(0);
    expect(await outboxEventsForJob(RUNNER_JOB_LEASE_EXPIRED, pending.jobId)).toHaveLength(0);
  });

  it('keeps a fresh manual stop handoff inside the cleanup grace', async () => {
    const pending = await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
    expect(claimed?.jobExecutionId).toBe(pending.jobExecutionId);

    await reconcileTerminalJobExecution({
      jobExecutionId: pending.jobExecutionId,
      cancellationReason: 'run_cancelled',
    });
    await db()
      .update(runningJobExecutions)
      .set({cancellationRequestedAt: new Date()})
      .where(eq(runningJobExecutions.jobExecutionId, pending.jobExecutionId));

    await detectAndExpireStuckJobs({thresholdSeconds: 180});

    const [handoff] = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobExecutionId, pending.jobExecutionId));
    expect(handoff?.cancellationReason).toBe('run_cancelled');
    expect(await outboxEventsForJob(RUNNER_JOB_LEASE_EXPIRED, pending.jobId)).toHaveLength(0);
  });

  it('cleans an expired managed stop handoff without a provider report', async () => {
    const pending = await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
    expect(claimed?.jobExecutionId).toBe(pending.jobExecutionId);
    const provisionerId = crypto.randomUUID();
    const providerRunnerId = crypto.randomUUID();
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId,
      state: 'terminated',
      terminatedAt: new Date(),
    });

    await reconcileTerminalJobExecution({
      jobExecutionId: pending.jobExecutionId,
      cancellationReason: 'run_cancelled',
    });
    await db()
      .update(runningJobExecutions)
      .set({
        provisionerId,
        providerRunnerId,
        cancellationRequestedAt: new Date(Date.now() - 300_000),
      })
      .where(eq(runningJobExecutions.jobExecutionId, pending.jobExecutionId));

    const result = await detectAndExpireStuckJobs({thresholdSeconds: 180});

    expect(result.expired).toBe(0);
    expect(
      await db()
        .select()
        .from(runningJobExecutions)
        .where(eq(runningJobExecutions.jobExecutionId, pending.jobExecutionId)),
    ).toHaveLength(0);
    expect(await outboxEventsForJob(RUNNER_JOB_LEASE_EXPIRED, pending.jobId)).toHaveLength(0);
  });

  it('reaps a correlated stale batch in shadow mode', async () => {
    const staleJobs = [await makeStaleJob(600), await makeStaleJob(600), await makeStaleJob(600)];

    const reaped = await expireStuckJobExecutions({
      thresholdSeconds: 180,
      noFirstHeartbeatGraceSeconds: 60,
      correlatedStaleMinCount: 3,
      correlatedStaleRatio: Number.MIN_VALUE,
      correlatedStaleMode: 'shadow',
    });

    expect(reaped).toHaveLength(3);
    expect(await outboxForJobs(staleJobs.map(({jobId}) => jobId))).toHaveLength(3);
  });

  it('releases a terminal runner reservation when its stuck lease is reaped', async () => {
    const stale = await makeStaleJob(600);
    const provisionerId = crypto.randomUUID();
    const providerRunnerId = crypto.randomUUID();
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
    if (!reservation) throw new Error('Expected reservation');
    await providerRunnerFactory.create({
      workspaceId,
      provisionerId,
      providerRunnerId,
      reservationId: reservation.id,
      runnerSessionId,
      state: 'terminated',
      terminatedAt: new Date(),
    });
    await db()
      .update(runningJobExecutions)
      .set({provisionerId, providerRunnerId})
      .where(eq(runningJobExecutions.jobExecutionId, stale.jobExecutionId));

    await expireStuckJobExecutions({
      noFirstHeartbeatGraceSeconds: 60,
      thresholdSeconds: 180,
    });

    expect(
      await db().select().from(reservations).where(eq(reservations.id, reservation.id)),
    ).toHaveLength(0);
    const [runner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.providerRunnerId, providerRunnerId));
    expect(runner?.reservationReleasedAt).toBeInstanceOf(Date);
  });

  it('does not requeue an execution after its lease has expired', async () => {
    const stale = await makeStaleJob(600);

    await expireStuckJobExecutions({
      noFirstHeartbeatGraceSeconds: 60,
      thresholdSeconds: 180,
    });

    await enqueueJobExecution({
      workspaceId,
      workflowRunId: stale.workflowRunId,
      workflowRunAttemptId: stale.workflowRunAttemptId,
      jobId: stale.jobId,
      jobExecutionId: stale.jobExecutionId,
      projectId: stale.projectId,
      requiredLabels: ['linux'],
      queuedAt: new Date(),
    });

    expect(
      await db()
        .select()
        .from(pendingJobExecutions)
        .where(eq(pendingJobExecutions.jobExecutionId, stale.jobExecutionId)),
    ).toHaveLength(0);
  });

  it('expires a job that never sent a first heartbeat after the startup grace', async () => {
    const {jobId, workflowRunId, workflowRunAttemptId} = await makeNoFirstHeartbeatJob(90);

    const result = await detectAndExpireStuckJobs({
      noFirstHeartbeatGraceSeconds: 60,
      thresholdSeconds: 180,
    });

    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(await runningJobsForTest()).toHaveLength(0);

    const outbox = await outboxForJobs([jobId]);
    expect(outbox).toHaveLength(1);
    const payload = outbox[0]?.payload as Record<string, unknown>;
    expect(payload.jobId).toBe(jobId);
    expect(payload.workflowRunId).toBe(workflowRunId);
    expect(payload.workflowRunAttemptId).toBe(workflowRunAttemptId);
  });

  it('does not expire a job that is still inside the first heartbeat grace', async () => {
    const {jobId} = await makeNoFirstHeartbeatJob(30);

    await detectAndExpireStuckJobs({
      noFirstHeartbeatGraceSeconds: 60,
      thresholdSeconds: 180,
    });

    expect(await runningJobsForTest()).toHaveLength(1);
    expect(await outboxForJobs([jobId])).toHaveLength(0);
  });

  it('does not expire a heartbeated job through the first heartbeat grace path', async () => {
    const {jobId} = await makeStaleJob(90);

    await detectAndExpireStuckJobs({
      noFirstHeartbeatGraceSeconds: 60,
      thresholdSeconds: 180,
    });

    expect(await runningJobsForTest()).toHaveLength(1);
    expect(await outboxForJobs([jobId])).toHaveLength(0);
  });

  it('uses the stale-heartbeat threshold for upgraded rows that heartbeated before first heartbeat tracking', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
    await db()
      .update(runningJobExecutions)
      .set({
        startedAt: sql`now() - interval '90 seconds'`,
        firstHeartbeatAt: null,
        lastHeartbeatAt: sql`now() - interval '30 seconds'`,
      })
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));

    await detectAndExpireStuckJobs({
      noFirstHeartbeatGraceSeconds: 60,
      thresholdSeconds: 180,
    });

    expect(await runningJobsForTest()).toHaveLength(1);
    expect(await outboxForJobs([claimed?.jobId as string])).toHaveLength(0);
  });

  it('expires upgraded heartbeated rows only after their stale-heartbeat threshold', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});
    await db()
      .update(runningJobExecutions)
      .set({
        startedAt: sql`now() - interval '900 seconds'`,
        firstHeartbeatAt: null,
        lastHeartbeatAt: sql`now() - interval '600 seconds'`,
      })
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));

    await detectAndExpireStuckJobs({
      noFirstHeartbeatGraceSeconds: 60,
      thresholdSeconds: 180,
    });

    expect(await runningJobsForTest()).toHaveLength(0);
    expect(await outboxForJobs([claimed?.jobId as string])).toHaveLength(1);
  });

  it('does not expire a job whose heartbeat is still inside the threshold window', async () => {
    const {jobId} = await makeStaleJob(60);

    await detectAndExpireStuckJobs({thresholdSeconds: 180});

    expect(await runningJobsForTest()).toHaveLength(1);
    expect(await outboxForJobs([jobId])).toHaveLength(0);
  });

  it('only expires the stuck rows in a mixed batch', async () => {
    const stuck1 = await makeStaleJob(600);
    const stuck2 = await makeStaleJob(600);
    const fresh = await makeStaleJob(30);

    await detectAndExpireStuckJobs({thresholdSeconds: 180});

    const remaining = await runningJobsForTest();
    expect(remaining.map((r) => r.jobId)).toEqual([fresh.jobId]);
    expect(await outboxForJobs([stuck1.jobId, stuck2.jobId, fresh.jobId])).toHaveLength(2);
  });

  it('returns zero when there are no stuck jobs', async () => {
    const result = await detectAndExpireStuckJobs({thresholdSeconds: 180});
    expect(result.expired).toBe(0);
  });

  it('skips a row whose heartbeat refreshed before the atomic DELETE re-evaluates the predicate', async () => {
    // Pre-stale, then refresh, then run: the cutoff is folded into the DELETE's
    // WHERE so the live row survives even though the iteration SELECT saw it stale.
    const {jobId} = await makeStaleJob(600);
    await db()
      .update(runningJobExecutions)
      .set({
        firstHeartbeatAt: sql`COALESCE(${runningJobExecutions.firstHeartbeatAt}, now())`,
        lastHeartbeatAt: sql`now()`,
      })
      .where(eq(runningJobExecutions.jobId, jobId));

    await detectAndExpireStuckJobs({thresholdSeconds: 180});

    expect(await runningJobsForTest()).toHaveLength(1);
    expect(await outboxForJobs([jobId])).toHaveLength(0);
  });

  it('double-expiring the same stuck job emits exactly one event', async () => {
    const {jobId} = await makeStaleJob(600);

    await detectAndExpireStuckJobs({thresholdSeconds: 180});
    await detectAndExpireStuckJobs({thresholdSeconds: 180});

    expect(
      await db().select().from(runningJobExecutions).where(eq(runningJobExecutions.jobId, jobId)),
    ).toHaveLength(0);
    expect(await outboxForJobs([jobId])).toHaveLength(1);
  });

  it('sweeps an orphan pending row for the job it reaps', async () => {
    const {jobId, jobExecutionId, workflowRunId, workflowRunAttemptId, projectId} =
      await makeStaleJob(600);
    // A post-claim enqueue retry left a pending row whose job is already running;
    // without this sweep it would stay re-claimable for an already-finished job.
    await db()
      .insert(pendingJobExecutions)
      .values({
        workspaceId,
        workflowRunId,
        jobId,
        jobExecutionId,
        workflowRunAttemptId,
        projectId,
        requiredLabels: ['linux'],
      });

    await detectAndExpireStuckJobs({thresholdSeconds: 180});

    expect(await runningJobsForTest()).toHaveLength(0);
    expect(
      await db().select().from(pendingJobExecutions).where(eq(pendingJobExecutions.jobId, jobId)),
    ).toHaveLength(0);
  });

  it('leaves the orphan pending row alone when the running row is not stale enough to reap', async () => {
    const {jobId, jobExecutionId, workflowRunId, workflowRunAttemptId, projectId} =
      await makeStaleJob(60);
    await db()
      .insert(pendingJobExecutions)
      .values({
        workspaceId,
        workflowRunId,
        jobId,
        jobExecutionId,
        workflowRunAttemptId,
        projectId,
        requiredLabels: ['linux'],
      });

    await detectAndExpireStuckJobs({thresholdSeconds: 180});

    // The sweep is gated on actually reaping a running row, so a live job's
    // pending row is untouched.
    expect(
      await db().select().from(pendingJobExecutions).where(eq(pendingJobExecutions.jobId, jobId)),
    ).toHaveLength(1);
  });

  it('returns the reaped workflow/job identifiers per row without leaking the internal id', async () => {
    const {jobId, jobExecutionId, workflowRunId, workflowRunAttemptId} = await makeStaleJob(600);

    const reaped = await expireStuckJobExecutions({
      noFirstHeartbeatGraceSeconds: 60,
      thresholdSeconds: 180,
    });

    const mine = reaped.find((row) => row.jobId === jobId);
    expect(mine).toEqual({jobId, jobExecutionId, workflowRunId, workflowRunAttemptId});
    expect(mine).not.toHaveProperty('id');
  });

  it('writes one lease_expired event per reaped job in a single bulk insert', async () => {
    const stuck1 = await makeStaleJob(600);
    const stuck2 = await makeStaleJob(600);

    await detectAndExpireStuckJobs({thresholdSeconds: 180});

    const outbox = await outboxForJobs([stuck1.jobId, stuck2.jobId]);
    expect(outbox).toHaveLength(2);
    expect(outbox.every((row) => row.eventType === RUNNER_JOB_LEASE_EXPIRED)).toBe(true);
  });

  it('two concurrent ticks reap each stuck job exactly once (no double-emit)', async () => {
    const stuck1 = await makeStaleJob(600);
    const stuck2 = await makeStaleJob(600);

    await Promise.all([
      detectAndExpireStuckJobs({thresholdSeconds: 180}),
      detectAndExpireStuckJobs({thresholdSeconds: 180}),
    ]);

    expect(await runningJobsForTest()).toHaveLength(0);
    expect(await outboxForJobs([stuck1.jobId, stuck2.jobId])).toHaveLength(2);
  });

  it('skips an execution whose advisory lock is held and reaps the next stale page', async () => {
    const first = await makeStaleJob(600);
    const second = await makeStaleJob(600);
    const releaseLock = deferred<void>();
    const lockReady = deferred<void>();
    const lockHolder = db().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`runners_job_execution:${first.jobExecutionId}`}))`,
      );
      lockReady.resolve();
      await releaseLock.promise;
    });

    try {
      await lockReady.promise;
      const reaped = await expireStuckJobExecutions({
        noFirstHeartbeatGraceSeconds: 60,
        thresholdSeconds: 180,
        limit: 1,
      });

      expect(reaped).toHaveLength(1);
      expect(reaped[0]?.jobExecutionId).toBe(second.jobExecutionId);
    } finally {
      releaseLock.resolve();
      await lockHolder;
    }

    const remaining = await expireStuckJobExecutions({
      noFirstHeartbeatGraceSeconds: 60,
      thresholdSeconds: 180,
      limit: 1,
    });
    expect(remaining.map((row) => row.jobExecutionId)).toContain(first.jobExecutionId);
  });

  it('a reaper tick and a concurrent claim of the same orphan-pending job do not deadlock', async () => {
    const {jobId, jobExecutionId, workflowRunId, workflowRunAttemptId, projectId} =
      await makeStaleJob(600);
    // Orphan pending row from a post-claim enqueue retry for an already-running job.
    await db()
      .insert(pendingJobExecutions)
      .values({
        workspaceId,
        workflowRunId,
        jobId,
        jobExecutionId,
        workflowRunAttemptId,
        projectId,
        requiredLabels: ['linux'],
      });

    // The reaper may acquire the execution lock first, or it may skip the row while the claim
    // transaction holds it. Either interleaving must complete without deadlocking.
    const [firstReap, claimed] = await Promise.all([
      detectAndExpireStuckJobs({thresholdSeconds: 180}),
      claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null}),
    ]);

    // Once the contending claim settles, the next tick reaps a row that the non-blocking
    // advisory-lock scan intentionally skipped.
    const secondReap = await detectAndExpireStuckJobs({thresholdSeconds: 180});

    expect(claimed).toBeNull();
    expect(firstReap.expired + secondReap.expired).toBeGreaterThanOrEqual(1);
    // The expired job is gone and not re-claimable; its orphan pending row is swept.
    expect(await runningJobsForTest()).toHaveLength(0);
    expect(
      await db().select().from(pendingJobExecutions).where(eq(pendingJobExecutions.jobId, jobId)),
    ).toHaveLength(0);
    expect(await outboxForJobs([jobId])).toHaveLength(1);
    expect(
      await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null}),
    ).toBeNull();
  });
});

describe('getJobExecutionQueueDepth', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  it('reports queue depth counters', async () => {
    const depth = await getJobExecutionQueueDepth();

    expect(depth.pendingJobExecutions).toBeGreaterThanOrEqual(0);
    expect(depth.runningJobExecutions).toBeGreaterThanOrEqual(0);
  });

  it('counts pending and running jobs separately', async () => {
    const baseline = await getJobExecutionQueueDepth();
    await pendingJobFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});
    await claimPendingJobExecution({workspaceId, runnerSessionId, maxClaims: null});

    const depth = await getJobExecutionQueueDepth();

    expect(depth).toEqual({
      pendingJobExecutions: baseline.pendingJobExecutions + 1,
      runningJobExecutions: baseline.runningJobExecutions + 1,
    });
  });
});

describe('getJobExecutionCleanupStats', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  it('reports stop-handoff count and oldest age', async () => {
    const baseline = await getJobExecutionCleanupStats();
    const first = await pendingJobFactory.create({workspaceId});
    const second = await pendingJobFactory.create({workspaceId});
    const firstClaim = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId,
      maxClaims: null,
    });
    const secondClaim = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId,
      maxClaims: null,
    });
    expect(firstClaim?.jobExecutionId).toBe(first.jobExecutionId);
    expect(secondClaim?.jobExecutionId).toBe(second.jobExecutionId);

    await db()
      .update(runningJobExecutions)
      .set({cancellationRequestedAt: new Date(Date.now() - 60_000)})
      .where(eq(runningJobExecutions.jobExecutionId, first.jobExecutionId));
    await db()
      .update(runningJobExecutions)
      .set({cancellationRequestedAt: new Date(Date.now() - 10_000)})
      .where(eq(runningJobExecutions.jobExecutionId, second.jobExecutionId));

    const stats = await getJobExecutionCleanupStats();

    expect(stats.stopHandoffCount).toBe(baseline.stopHandoffCount + 2);
    expect(stats.stopHandoffOldestAgeMilliseconds).toBeGreaterThanOrEqual(59_000);
  });
});
