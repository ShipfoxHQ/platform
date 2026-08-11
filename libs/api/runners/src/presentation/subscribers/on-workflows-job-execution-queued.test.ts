import type {WorkflowsJobExecutionQueuedEventDto} from '@shipfox/api-workflows-dto';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {claimPendingJobExecution} from '#db/job-executions.js';
import {pendingJobExecutions} from '#db/schema/pending-job-executions.js';
import {runningJobExecutions} from '#db/schema/running-job-executions.js';
import {runnerSessionFactory} from '#test/index.js';
import {onWorkflowsJobExecutionQueued} from './on-workflows-job-execution-queued.js';

describe('onWorkflowsJobExecutionQueued', () => {
  it('queues from the workflow timestamp and is idempotent across claim', async () => {
    const workspaceId = crypto.randomUUID();
    const payload: WorkflowsJobExecutionQueuedEventDto = {
      jobId: crypto.randomUUID(),
      jobExecutionId: crypto.randomUUID(),
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      workspaceId,
      projectId: crypto.randomUUID(),
      requiredLabels: ['linux'],
      queuedAt: '2026-08-11T08:00:00.000Z',
    };

    await onWorkflowsJobExecutionQueued(payload);
    await onWorkflowsJobExecutionQueued(payload);

    const pending = await db()
      .select()
      .from(pendingJobExecutions)
      .where(eq(pendingJobExecutions.jobExecutionId, payload.jobExecutionId));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.createdAt.toISOString()).toBe(payload.queuedAt);

    const session = await runnerSessionFactory.create({workspaceId});
    await claimPendingJobExecution({
      workspaceId,
      runnerSessionId: session.id,
      sessionLabels: ['linux'],
      maxClaims: null,
      runnerSessionLivenessThrottleSeconds: 10,
    });
    await onWorkflowsJobExecutionQueued(payload);

    expect(
      await db()
        .select()
        .from(pendingJobExecutions)
        .where(eq(pendingJobExecutions.jobExecutionId, payload.jobExecutionId)),
    ).toHaveLength(0);
    expect(
      await db()
        .select()
        .from(runningJobExecutions)
        .where(eq(runningJobExecutions.jobExecutionId, payload.jobExecutionId)),
    ).toHaveLength(1);
  });
});
