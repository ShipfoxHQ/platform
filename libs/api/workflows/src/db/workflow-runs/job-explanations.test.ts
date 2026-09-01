import {inArray} from 'drizzle-orm';
import {createHighCardinalityWorkflowRun} from '#test/index.js';
import {db} from '../db.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobs} from '../schema/jobs.js';
import {listWorkflowRunJobExplanationsPage} from '../workflow-runs.js';

describe('workflow run job explanation reads', () => {
  test('lists failed and skipped jobs without executions with stable pagination', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 3,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });
    const failedJobId = fixture.jobIds[0] as string;
    const skippedJobId = fixture.jobIds[1] as string;

    await db()
      .delete(jobExecutions)
      .where(inArray(jobExecutions.jobId, [failedJobId, skippedJobId]));
    await db()
      .update(jobs)
      .set({status: 'failed', statusReason: 'step_failed'})
      .where(inArray(jobs.id, [failedJobId]));
    await db()
      .update(jobs)
      .set({status: 'skipped', statusReason: 'condition_rejected'})
      .where(inArray(jobs.id, [skippedJobId]));

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
});
