import {and, asc, eq, inArray} from 'drizzle-orm';
import {createHighCardinalityWorkflowRun} from '#test/index.js';
import {db} from '../db.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobs} from '../schema/jobs.js';
import {stepAttempts} from '../schema/step-attempts.js';
import {steps} from '../schema/steps.js';
import {listFailedStepAttempts} from '../workflow-runs.js';

describe('failed workflow step-attempt coordinate reads', () => {
  test('returns only a deterministic bounded prefix', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 2,
      dependenciesPerJob: 0,
      executionsPerJob: 3,
      stepsPerExecution: 2,
      attemptsPerStep: 4,
    });

    const page = await listFailedStepAttempts({
      workspaceId: fixture.run.workspaceId,
      projectId: fixture.run.projectId,
      workflowRunId: fixture.run.id,
      attempt: 1,
      limit: 10,
    });

    expect(page).toHaveLength(10);
    const ids = page?.map((coordinate) => coordinate.stepAttemptId) ?? [];
    const rows = await db()
      .select({
        id: stepAttempts.id,
        status: stepAttempts.status,
        jobPosition: jobs.position,
        executionSequence: jobExecutions.sequence,
        stepPosition: steps.position,
        attempt: stepAttempts.attempt,
      })
      .from(stepAttempts)
      .innerJoin(
        steps,
        and(
          eq(stepAttempts.stepId, steps.id),
          eq(stepAttempts.jobExecutionId, steps.jobExecutionId),
        ),
      )
      .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
      .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
      .where(inArray(stepAttempts.id, ids))
      .orderBy(
        asc(jobs.position),
        asc(jobExecutions.sequence),
        asc(steps.position),
        asc(stepAttempts.attempt),
        asc(stepAttempts.id),
      );

    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.status === 'failed')).toBe(true);
    expect(page?.map((coordinate) => coordinate.stepAttemptId)).toEqual(rows.map((row) => row.id));
    expect(page?.every((coordinate) => coordinate.workflowRunId === fixture.run.id)).toBe(true);
    expect(page?.every((coordinate) => coordinate.workflowRunAttempt === 1)).toBe(true);
  });

  test('does not expose coordinates across workspace, project, or attempt boundaries', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 4,
    });
    const base = {
      workflowRunId: fixture.run.id,
      projectId: fixture.run.projectId,
      attempt: 1,
      limit: 10,
    };

    await expect(
      listFailedStepAttempts({
        ...base,
        workspaceId: crypto.randomUUID(),
      }),
    ).resolves.toBeUndefined();
    await expect(
      listFailedStepAttempts({
        ...base,
        workspaceId: fixture.run.workspaceId,
        projectId: crypto.randomUUID(),
      }),
    ).resolves.toBeUndefined();
    await expect(
      listFailedStepAttempts({
        ...base,
        workspaceId: fixture.run.workspaceId,
        attempt: 2,
      }),
    ).resolves.toBeUndefined();
  });
});
