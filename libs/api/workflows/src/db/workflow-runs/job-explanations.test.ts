import {inArray} from 'drizzle-orm';
import {createHighCardinalityWorkflowRun} from '#test/index.js';
import {db} from '../db.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobs} from '../schema/jobs.js';
import {listWorkflowRunJobExplanationsPage} from '../workflow-runs.js';

describe('workflow run job explanation reads', () => {
  test('lists failed and skipped jobs without executions with stable pagination', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 4,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });
    const failedJobId = fixture.jobIds[0] as string;
    const skippedJobId = fixture.jobIds[1] as string;
    const pendingJobId = fixture.jobIds[2] as string;
    const failedWithExecutionJobId = fixture.jobIds[3] as string;

    await db()
      .delete(jobExecutions)
      .where(inArray(jobExecutions.jobId, [failedJobId, skippedJobId, pendingJobId]));
    await db()
      .update(jobs)
      .set({status: 'failed', statusReason: 'step_failed'})
      .where(inArray(jobs.id, [failedJobId]));
    await db()
      .update(jobs)
      .set({status: 'skipped', statusReason: 'condition_rejected'})
      .where(inArray(jobs.id, [skippedJobId]));
    await db()
      .update(jobs)
      .set({status: 'pending', statusReason: null})
      .where(inArray(jobs.id, [pendingJobId]));
    await db()
      .update(jobs)
      .set({status: 'failed', statusReason: 'step_failed'})
      .where(inArray(jobs.id, [failedWithExecutionJobId]));

    const firstPage = await listWorkflowRunJobExplanationsPage({
      workspaceId: fixture.run.workspaceId,
      projectId: fixture.run.projectId,
      workflowRunId: fixture.run.id,
      attempt: 1,
      limit: 1,
    });
    const secondPage = await listWorkflowRunJobExplanationsPage({
      workspaceId: fixture.run.workspaceId,
      projectId: fixture.run.projectId,
      workflowRunId: fixture.run.id,
      attempt: 1,
      limit: 1,
      cursor: firstPage?.nextCursor ?? undefined,
    });

    expect(firstPage?.items).toMatchObject([
      {jobId: failedJobId, jobLabel: 'measurement-job-0', status: 'failed'},
    ]);
    expect(firstPage?.nextCursor).toMatchObject({position: 0, id: failedJobId});
    expect(secondPage?.items).toMatchObject([
      {jobId: skippedJobId, jobLabel: 'measurement-job-1', status: 'skipped'},
    ]);
    expect(secondPage?.nextCursor).toBeNull();
  });

  test('does not return explanations outside the requested workspace, project, or attempt', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });

    expect(
      await listWorkflowRunJobExplanationsPage({
        workspaceId: crypto.randomUUID(),
        projectId: fixture.run.projectId,
        workflowRunId: fixture.run.id,
        attempt: 1,
        limit: 100,
      }),
    ).toBeUndefined();
    expect(
      await listWorkflowRunJobExplanationsPage({
        workspaceId: fixture.run.workspaceId,
        projectId: crypto.randomUUID(),
        workflowRunId: fixture.run.id,
        attempt: 1,
        limit: 100,
      }),
    ).toBeUndefined();
    expect(
      await listWorkflowRunJobExplanationsPage({
        workspaceId: fixture.run.workspaceId,
        projectId: fixture.run.projectId,
        workflowRunId: fixture.run.id,
        attempt: 2,
        limit: 100,
      }),
    ).toBeUndefined();
  });
});
