import type {WorkflowsJobExecutionTimedOutEventDto} from '@shipfox/api-workflows-dto';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {claimPendingJobExecution} from '#db/job-executions.js';
import {pendingJobExecutions} from '#db/schema/pending-job-executions.js';
import {runningJobExecutions} from '#db/schema/running-job-executions.js';
import {pendingJobFactory, runnerSessionFactory} from '#test/index.js';
import {onWorkflowsJobExecutionTimedOut} from './on-workflows-job-execution-timed-out.js';

function buildPayload(
  jobId: string,
  jobExecutionId: string,
  workflowRunAttemptId: string,
): WorkflowsJobExecutionTimedOutEventDto {
  return {jobId, jobExecutionId, workflowRunAttemptId};
}

describe('onWorkflowsJobExecutionTimedOut', () => {
  let workspaceId: string;
  let runnerSessionId: string;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    const runnerSession = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = runnerSession.id;
  });

  it('deletes an unclaimed pending execution', async () => {
    const pending = await pendingJobFactory.create({workspaceId});

    await onWorkflowsJobExecutionTimedOut(
      buildPayload(pending.jobId, pending.jobExecutionId, pending.workflowRunAttemptId),
    );

    expect(
      await db()
        .select()
        .from(pendingJobExecutions)
        .where(eq(pendingJobExecutions.jobExecutionId, pending.jobExecutionId)),
    ).toHaveLength(0);
  });

  it('sets cancellation_requested_at on the matching running_jobs row', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId,
      sessionLabels: ['linux', 'x64'],
      maxClaims: null,
      runnerSessionLivenessThrottleSeconds: 10,
    });
    expect(claimed).not.toBeNull();

    await onWorkflowsJobExecutionTimedOut(
      buildPayload(
        claimed?.jobId as string,
        claimed?.jobExecutionId as string,
        claimed?.workflowRunAttemptId as string,
      ),
    );

    const rows = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    expect(rows[0]?.cancellationRequestedAt).not.toBeNull();
  });

  it('does not cancel another running execution for the same job', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId,
      sessionLabels: ['linux', 'x64'],
      maxClaims: null,
      runnerSessionLivenessThrottleSeconds: 10,
    });
    expect(claimed).not.toBeNull();
    const siblingJobExecutionId = crypto.randomUUID();
    const siblingRunnerSession = await runnerSessionFactory.create({workspaceId});
    await db()
      .insert(runningJobExecutions)
      .values({
        workspaceId,
        workflowRunId: claimed?.workflowRunId as string,
        jobId: claimed?.jobId as string,
        jobExecutionId: siblingJobExecutionId,
        workflowRunAttemptId: claimed?.workflowRunAttemptId as string,
        projectId: claimed?.projectId as string,
        runnerSessionId: siblingRunnerSession.id,
        requiredLabels: ['linux'],
        runnerLabels: ['linux', 'x64'],
      });

    await onWorkflowsJobExecutionTimedOut(
      buildPayload(
        claimed?.jobId as string,
        claimed?.jobExecutionId as string,
        claimed?.workflowRunAttemptId as string,
      ),
    );

    const rows = await db()
      .select({
        jobExecutionId: runningJobExecutions.jobExecutionId,
        cancellationRequestedAt: runningJobExecutions.cancellationRequestedAt,
      })
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    const byJobExecutionId = new Map(
      rows.map((row) => [row.jobExecutionId, row.cancellationRequestedAt]),
    );
    expect(byJobExecutionId.get(claimed?.jobExecutionId as string)).not.toBeNull();
    expect(byJobExecutionId.get(siblingJobExecutionId)).toBeNull();
  });

  it('idempotent under double delivery: second call preserves the first timestamp', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimPendingJobExecution({
      workspaceId,
      runnerSessionId,
      sessionLabels: ['linux', 'x64'],
      maxClaims: null,
      runnerSessionLivenessThrottleSeconds: 10,
    });

    await onWorkflowsJobExecutionTimedOut(
      buildPayload(
        claimed?.jobId as string,
        claimed?.jobExecutionId as string,
        claimed?.workflowRunAttemptId as string,
      ),
    );
    const after1 = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    const firstTs = after1[0]?.cancellationRequestedAt;

    await new Promise((r) => setTimeout(r, 10));
    await onWorkflowsJobExecutionTimedOut(
      buildPayload(
        claimed?.jobId as string,
        claimed?.jobExecutionId as string,
        claimed?.workflowRunAttemptId as string,
      ),
    );

    const after2 = await db()
      .select()
      .from(runningJobExecutions)
      .where(eq(runningJobExecutions.jobId, claimed?.jobId as string));
    expect(after2[0]?.cancellationRequestedAt?.getTime()).toBe(firstTs?.getTime());
  });

  it('no-op when the running_jobs row is gone (already finalized)', async () => {
    await expect(
      onWorkflowsJobExecutionTimedOut(
        buildPayload(crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()),
      ),
    ).resolves.toBeUndefined();
  });
});
