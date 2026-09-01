import {WORKFLOW_RUN_EXECUTION_COUNT_LIMIT} from '@shipfox/api-workflows-dto';
import {eq} from 'drizzle-orm';
import {buildModel} from '#test/helpers/workflow-runs.js';
import {createHighCardinalityWorkflowRun} from '#test/index.js';
import {db} from '../db.js';
import {jobExecutions} from '../schema/job-executions.js';
import {steps} from '../schema/steps.js';
import {
  createWorkflowRun,
  getJobsByWorkflowRunId,
  getWorkflowRunOverview,
  listWorkflowRunJobsPage,
} from '../workflow-runs.js';

describe('bounded workflow run overview reads', () => {
  test('returns a compact complete graph without heavy fields', async () => {
    const projectId = crypto.randomUUID();
    const run = await createWorkflowRun({
      workspaceId: crypto.randomUUID(),
      projectId,
      definitionId: crypto.randomUUID(),
      model: buildModel({
        jobs: {
          build: {steps: [{run: 'echo build'}]},
          test: {needs: 'build', steps: [{run: 'echo test'}]},
        },
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });

    const overview = await getWorkflowRunOverview({
      workflowRunId: run.id,
      projectId,
      attempt: 1,
    });

    expect(overview?.jobs).toMatchObject({kind: 'complete', total: 2});
    if (overview?.jobs.kind !== 'complete') throw new Error('Expected complete overview');
    expect(overview.jobs.items).toHaveLength(2);
    expect(overview.jobs.items.map((job) => job.key)).toEqual(['build', 'test']);
    expect(overview.jobs.items[1]?.dependencies).toEqual(['build']);
    expect(overview.jobs.items[0]).not.toHaveProperty('outputs');
    expect(overview.jobs.items[0]?.executionStatusCounts).toEqual({
      pending: 1,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    });
  });

  test('derives visible execution status and prioritizes a running execution', async () => {
    const projectId = crypto.randomUUID();
    const run = await createWorkflowRun({
      workspaceId: crypto.randomUUID(),
      projectId,
      definitionId: crypto.randomUUID(),
      model: buildModel(),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });

    const jobs = await getJobsByWorkflowRunId(run.id);
    const build = jobs[0];
    if (!build) throw new Error('Expected build job');
    const [execution] = await db()
      .select({id: jobExecutions.id})
      .from(jobExecutions)
      .where(eq(jobExecutions.jobId, build.id))
      .limit(1);
    if (!execution) throw new Error('Expected build execution');
    const [step] = await db()
      .select({id: steps.id})
      .from(steps)
      .where(eq(steps.jobExecutionId, execution.id))
      .orderBy(steps.position)
      .limit(1);
    if (!step) throw new Error('Expected build step');

    const startedAt = new Date('2026-09-01T10:00:00.000Z');
    await db()
      .update(jobExecutions)
      .set({status: 'running', startedAt, updatedAt: startedAt})
      .where(eq(jobExecutions.id, execution.id));

    const waiting = await getWorkflowRunOverview({
      workflowRunId: run.id,
      projectId,
      attempt: 1,
    });
    if (waiting?.jobs.kind !== 'complete') {
      throw new Error('Expected complete overview while execution is running');
    }
    const waitingBuild = waiting.jobs.items.find((job) => job.id === build.id);
    expect(waiting.hasStartedJobExecution).toBe(true);
    expect(waitingBuild?.defaultExecution).toMatchObject({
      id: execution.id,
      status: 'running',
      displayStatus: 'pending',
    });
    expect(waitingBuild?.executionStatusCounts).toEqual({
      pending: 1,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    });

    await db()
      .update(steps)
      .set({status: 'running', updatedAt: startedAt})
      .where(eq(steps.id, step.id));

    const visible = await getWorkflowRunOverview({
      workflowRunId: run.id,
      projectId,
      attempt: 1,
    });
    if (visible?.jobs.kind !== 'complete') {
      throw new Error('Expected complete overview after step starts');
    }
    const visibleBuild = visible.jobs.items.find((job) => job.id === build.id);
    expect(visibleBuild?.defaultExecution).toMatchObject({
      id: execution.id,
      status: 'running',
      displayStatus: 'running',
    });
    expect(visibleBuild?.executionStatusCounts).toEqual({
      pending: 0,
      running: 1,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    });

    await db().insert(jobExecutions).values({
      jobId: build.id,
      sequence: 2,
      status: 'succeeded',
      triggerEvents: [],
      finishedAt: startedAt,
      updatedAt: startedAt,
    });

    const runningWins = await getWorkflowRunOverview({
      workflowRunId: run.id,
      projectId,
      attempt: 1,
    });
    if (runningWins?.jobs.kind !== 'complete') {
      throw new Error('Expected complete overview after retry');
    }
    const retriedBuild = runningWins.jobs.items.find((job) => job.id === build.id);
    expect(retriedBuild?.defaultExecution?.id).toBe(execution.id);
    expect(retriedBuild?.executionStatusCounts).toEqual({
      pending: 0,
      running: 1,
      succeeded: 1,
      failed: 0,
      cancelled: 0,
    });
  });

  test('returns a bounded first page and stable continuation for large workflows', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 101,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });

    const overview = await getWorkflowRunOverview({
      workflowRunId: fixture.run.id,
      projectId: fixture.run.projectId,
      attempt: 1,
    });

    if (overview?.jobs.kind !== 'large') throw new Error('Expected large overview');
    expect(overview.jobs.total).toBe(101);
    expect(overview.jobs.firstPage.items).toHaveLength(100);
    expect(overview.jobs.firstPage.items[0]?.position).toBe(0);
    expect(overview.jobs.firstPage.items.at(-1)?.position).toBe(99);
    expect(overview.jobs.firstPage.nextCursor).not.toBeNull();
    expect(overview.jobs.firstPage.items[0]).not.toHaveProperty('dependencies');

    const page = await listWorkflowRunJobsPage({
      workflowRunId: fixture.run.id,
      projectId: fixture.run.projectId,
      attempt: 1,
      limit: 100,
      cursor: overview.jobs.firstPage.nextCursor ?? undefined,
    });

    expect(page?.items).toHaveLength(1);
    expect(page?.items[0]?.position).toBe(100);
    expect(page?.items[0]).not.toHaveProperty('dependencies');
    expect(page?.total).toBeUndefined();
    expect(page?.nextCursor).toBeNull();
  });

  test('caps execution counts while retaining the selected running execution', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: WORKFLOW_RUN_EXECUTION_COUNT_LIMIT + 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });

    const overview = await getWorkflowRunOverview({
      workflowRunId: fixture.run.id,
      projectId: fixture.run.projectId,
      attempt: 1,
    });

    if (overview?.jobs.kind !== 'complete') {
      throw new Error('Expected complete overview');
    }
    const job = overview.jobs.items[0];
    expect(job?.executionCount).toBe('100+');
    expect(job?.defaultExecution?.status).toBe('running');
    expect(job?.defaultExecution?.displayStatus).toBe('pending');
  });

  test('returns no overview for a run from another project or an unknown attempt', async () => {
    const run = await createWorkflowRun({
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      definitionId: crypto.randomUUID(),
      model: buildModel(),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });

    await expect(
      getWorkflowRunOverview({
        workflowRunId: run.id,
        projectId: crypto.randomUUID(),
        attempt: 1,
      }),
    ).resolves.toBeUndefined();
    await expect(
      getWorkflowRunOverview({
        workflowRunId: run.id,
        projectId: run.projectId,
        attempt: 2,
      }),
    ).resolves.toBeUndefined();
  });
});
