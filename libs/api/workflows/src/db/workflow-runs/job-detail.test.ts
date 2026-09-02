import {eq} from 'drizzle-orm';
import {createHighCardinalityWorkflowRun} from '#test/index.js';
import {db} from '../db.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobs} from '../schema/jobs.js';
import {stepAttempts} from '../schema/step-attempts.js';
import {steps} from '../schema/steps.js';
import {
  getWorkflowJobDetail,
  listWorkflowExecutionSteps,
  listWorkflowJobExecutionSummaries,
  listWorkflowStepAttemptSummaries,
} from '../workflow-runs.js';

describe('selected workflow job reads', () => {
  test('selects the active execution and embeds bounded step-attempt previews', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 3,
      stepsPerExecution: 2,
      attemptsPerStep: 12,
    });

    const detail = await getWorkflowJobDetail({jobId: fixture.jobIds[0] as string});

    expect(detail?.job.id).toBe(fixture.jobIds[0]);
    expect(detail?.selectedExecution?.id).toBe(fixture.executionIds[0]);
    expect(detail?.selectedExecution?.sequence).toBe(1);
    expect(detail?.selectedExecution?.steps.total).toBe(2);
    expect(detail?.selectedExecution?.steps.items).toHaveLength(2);
    expect(
      detail?.selectedExecution?.steps.items[0]?.attempts.items.map((item) => item.attempt),
    ).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    expect(detail?.selectedExecution?.steps.items[0]?.attempts.total).toBe(12);
    expect(detail?.selectedExecution?.steps.items[0]?.attempts.nextCursor).not.toBeNull();
    expect(detail?.selectedExecution?.steps.items[0]).not.toHaveProperty('job');
    expect(detail?.selectedExecution).not.toHaveProperty('outputs');
  });

  test('pages executions, steps, and attempts with stable composite cursors', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 3,
      stepsPerExecution: 3,
      attemptsPerStep: 3,
    });
    const jobId = fixture.jobIds[0] as string;
    const executionId = fixture.executionIds[0] as string;
    const stepId = fixture.stepIds[0] as string;

    const executions = await listWorkflowJobExecutionSummaries({jobId, limit: 2});
    expect(executions?.items.map((item) => item.sequence)).toEqual([3, 2]);
    expect(executions?.total).toBe(3);
    expect(executions?.nextCursor).not.toBeNull();

    const executionContinuation = await listWorkflowJobExecutionSummaries({
      jobId,
      limit: 2,
      cursor: executions?.nextCursor ?? undefined,
    });
    expect(executionContinuation?.items.map((item) => item.sequence)).toEqual([1]);
    expect(executionContinuation?.total).toBeUndefined();

    const steps = await listWorkflowExecutionSteps({jobId, executionId, limit: 2});
    expect(steps?.items.map((item) => item.position)).toEqual([0, 1]);
    expect(steps?.total).toBe(3);
    expect(steps?.nextCursor).not.toBeNull();

    const stepContinuation = await listWorkflowExecutionSteps({
      jobId,
      executionId,
      limit: 2,
      cursor: steps?.nextCursor ?? undefined,
    });
    expect(stepContinuation?.items.map((item) => item.position)).toEqual([2]);
    expect(stepContinuation?.total).toBeUndefined();

    const attempts = await listWorkflowStepAttemptSummaries({stepId, limit: 2});
    expect(attempts?.items.map((item) => item.attempt)).toEqual([3, 2]);
    expect(attempts?.total).toBe(3);
    expect(attempts?.nextCursor).not.toBeNull();

    const attemptContinuation = await listWorkflowStepAttemptSummaries({
      stepId,
      limit: 2,
      cursor: attempts?.nextCursor ?? undefined,
    });
    expect(attemptContinuation?.items.map((item) => item.attempt)).toEqual([1]);
    expect(attemptContinuation?.total).toBeUndefined();
  });

  test('does not let newer inserts reappear before a continuation cursor', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 3,
      stepsPerExecution: 1,
      attemptsPerStep: 3,
    });
    const jobId = fixture.jobIds[0] as string;

    const firstExecutionPage = await listWorkflowJobExecutionSummaries({jobId, limit: 1});
    await db().insert(jobExecutions).values({
      jobId,
      sequence: 4,
      status: 'succeeded',
      triggerEvents: [],
      updatedAt: new Date(),
    });

    const nextExecutionPage = await listWorkflowJobExecutionSummaries({
      jobId,
      limit: 1,
      cursor: firstExecutionPage?.nextCursor ?? undefined,
    });
    expect(firstExecutionPage?.items[0]?.sequence).toBe(3);
    expect(nextExecutionPage?.items[0]?.sequence).toBe(2);
  });

  test('returns undefined for mismatched execution and step ancestry', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 2,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });

    await expect(
      listWorkflowExecutionSteps({
        jobId: fixture.jobIds[0] as string,
        executionId: fixture.executionIds[1] as string,
        limit: 10,
      }),
    ).resolves.toBeUndefined();

    await expect(
      getWorkflowJobDetail({
        jobId: fixture.jobIds[0] as string,
        executionId: fixture.executionIds[1] as string,
      }),
    ).resolves.toBeUndefined();

    await expect(
      listWorkflowStepAttemptSummaries({
        stepId: crypto.randomUUID(),
        limit: 10,
      }),
    ).resolves.toBeUndefined();
  });

  test('keeps attempt pagination stable when a newer attempt is inserted', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 3,
    });
    const stepId = fixture.stepIds[0] as string;
    const executionId = fixture.executionIds[0] as string;

    const firstPage = await listWorkflowStepAttemptSummaries({stepId, limit: 1});
    const [stepAttempt] = await db()
      .select({id: stepAttempts.id})
      .from(stepAttempts)
      .where(eq(stepAttempts.stepId, stepId))
      .limit(1);
    expect(stepAttempt).toBeDefined();
    await db().insert(stepAttempts).values({
      stepId,
      jobExecutionId: executionId,
      attempt: 4,
      executionOrder: 4,
      status: 'succeeded',
      invocations: [],
    });

    const continuation = await listWorkflowStepAttemptSummaries({
      stepId,
      limit: 1,
      cursor: firstPage?.nextCursor ?? undefined,
    });
    expect(firstPage?.items[0]?.attempt).toBe(3);
    expect(continuation?.items[0]?.attempt).toBe(2);
  });

  test('returns an empty selection and empty nested history pages', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 2,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });
    const jobId = fixture.jobIds[0] as string;
    const firstExecutionId = fixture.executionIds[0] as string;
    const secondExecutionId = fixture.executionIds[1] as string;
    const emptyJobId = crypto.randomUUID();
    const emptyStepId = crypto.randomUUID();

    await db().insert(jobs).values({
      id: emptyJobId,
      workflowRunAttemptId: fixture.workflowRunAttemptId,
      key: 'empty-job',
      checkoutPersistCredentials: true,
      checkoutPermissionsContents: 'read',
      dependencies: [],
      position: 10,
    });

    const emptyJobDetail = await getWorkflowJobDetail({jobId: emptyJobId});
    expect(emptyJobDetail?.selectedExecution).toBeNull();

    const explicitDetail = await getWorkflowJobDetail({
      jobId,
      executionId: secondExecutionId,
    });
    expect(explicitDetail?.selectedExecution?.id).toBe(secondExecutionId);
    expect(explicitDetail?.selectedExecution?.sequence).toBe(2);

    await db().insert(steps).values({
      id: emptyStepId,
      jobExecutionId: firstExecutionId,
      key: 'empty-step',
      name: 'Empty step',
      type: 'run',
      config: {},
      position: 10,
    });
    const detailWithEmptyStep = await getWorkflowJobDetail({jobId});
    expect(
      detailWithEmptyStep?.selectedExecution?.steps.items.find((step) => step.id === emptyStepId)
        ?.attempts,
    ).toEqual({items: [], nextCursor: null, total: 0});
  });
});
