import type {WorkflowsJobExecutionTerminatedEventDto} from '@shipfox/api-workflows-dto';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {reservations} from '#db/schema/reservations.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {runningJobExecutions} from '#db/schema/running-job-executions.js';
import {providerRunnerFactory, runnerSessionFactory} from '#test/index.js';
import {onWorkflowsJobExecutionTerminated} from './on-workflows-job-execution-terminated.js';

describe('onWorkflowsJobExecutionTerminated', () => {
  it('releases a terminal runner reservation once no uncancelled lease remains', async () => {
    const workspaceId = crypto.randomUUID();
    const provisionerId = crypto.randomUUID();
    const providerRunnerId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    const workflowRunAttemptId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const jobExecutionId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
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
      runnerSessionId: runnerSession.id,
      state: 'terminated',
      terminatedAt: new Date(),
    });
    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        workflowRunId,
        workflowRunAttemptId,
        jobId,
        jobExecutionId,
        projectId,
        runnerSessionId: runnerSession.id,
        provisionerId,
        providerRunnerId,
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
      });
    const payload: WorkflowsJobExecutionTerminatedEventDto = {
      jobId,
      jobExecutionId,
      workflowRunId,
      workflowRunAttemptId,
      status: 'cancelled',
      statusReason: 'run_cancelled',
      statusReasonMessage: null,
    };

    await onWorkflowsJobExecutionTerminated(payload);
    await onWorkflowsJobExecutionTerminated(payload);

    expect(
      await db().select().from(reservations).where(eq(reservations.id, reservation.id)),
    ).toHaveLength(0);
    const [runner] = await db()
      .select()
      .from(providerRunners)
      .where(eq(providerRunners.providerRunnerId, providerRunnerId));
    expect(runner?.reservationReleasedAt).toBeInstanceOf(Date);
    const [lease] = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobExecutionId, jobExecutionId));
    expect(lease?.cancellationRequestedAt).toBeInstanceOf(Date);
  });

  it('keeps the reservation while the provider runner is non-terminal', async () => {
    const workspaceId = crypto.randomUUID();
    const provisionerId = crypto.randomUUID();
    const providerRunnerId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
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
      runnerSessionId: runnerSession.id,
      state: 'running',
    });
    const workflowRunId = crypto.randomUUID();
    const workflowRunAttemptId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const jobExecutionId = crypto.randomUUID();
    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        workflowRunId,
        workflowRunAttemptId,
        jobId,
        jobExecutionId,
        projectId: crypto.randomUUID(),
        runnerSessionId: runnerSession.id,
        provisionerId,
        providerRunnerId,
        requiredLabels: ['linux'],
        runnerLabels: ['linux'],
      });

    await onWorkflowsJobExecutionTerminated({
      jobId,
      jobExecutionId,
      workflowRunId,
      workflowRunAttemptId,
      status: 'failed',
      statusReason: 'step_failed',
      statusReasonMessage: null,
    });

    expect(
      await db().select().from(reservations).where(eq(reservations.id, reservation.id)),
    ).toHaveLength(1);
  });
});
