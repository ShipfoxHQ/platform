import {eq} from 'drizzle-orm';
import {
  loadCheckoutRenewalSubject,
  promoteCheckoutRenewalSubject,
  savePendingCheckoutRenewalSubject,
} from '#db/checkout-renewal-subjects.js';
import {db, withTransaction} from '#db/db.js';
import {checkoutRenewalSubjects} from '#db/schema/checkout-renewal-subjects.js';
import {jobExecutions} from '#db/schema/job-executions.js';
import {jobs} from '#db/schema/jobs.js';
import {steps} from '#db/schema/steps.js';
import {
  finishStepAttempt,
  insertRunningStepAttempt,
  rewindStepsToPending,
} from '#db/workflow-runs/steps.js';
import {
  createWorkflowRun,
  getJobExecutionsByJobId,
  getJobsByWorkflowRunId,
  getStepsByJobId,
} from '#db/workflow-runs.js';
import {workflowModel} from '#test/factories/workflow-model.js';

async function checkoutFixture(persistCredentials = true) {
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const run = await createWorkflowRun({
    workspaceId,
    projectId,
    definitionId: crypto.randomUUID(),
    model: workflowModel({
      jobs: {
        build: {
          checkout: false,
          steps: [
            {
              checkout: {
                repository: 'acme/repo',
                fetchDepth: 1,
                permissions: {contents: 'write'},
                persistCredentials,
              },
            },
          ],
        },
      },
    }),
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      userId: crypto.randomUUID(),
    },
  });
  const [job] = await getJobsByWorkflowRunId(run.id);
  if (!job) throw new Error('Expected workflow job');
  const [execution] = await getJobExecutionsByJobId(job.id);
  if (!execution) throw new Error('Expected job execution');
  const [step] = (await getStepsByJobId(job.id)).filter(
    (candidate) => candidate.type === 'checkout',
  );
  if (!step) throw new Error('Expected checkout step');

  await db().update(jobs).set({status: 'running'}).where(eq(jobs.id, job.id));
  await db()
    .update(jobExecutions)
    .set({status: 'running'})
    .where(eq(jobExecutions.id, execution.id));
  await db().update(steps).set({status: 'running'}).where(eq(steps.id, step.id));

  return {run, job, execution, step};
}

function subject(fixture: Awaited<ReturnType<typeof checkoutFixture>>, attempt = 1) {
  return {
    repositoryUrl: 'https://github.com/acme/repo.git',
    connectionId: crypto.randomUUID(),
    externalRepositoryId: 'github:repo-1',
    permissions: {contents: 'write' as const},
    stepId: fixture.step.id,
    attempt,
    jobExecutionId: fixture.execution.id,
    workflowRunAttemptId: fixture.job.workflowRunAttemptId,
  };
}

describe('checkout renewal subjects', () => {
  test('promotes one frozen subject after the matching attempt succeeds', async () => {
    const fixture = await checkoutFixture();
    const first = subject(fixture);
    first.repositoryUrl = ' HTTPS://GitHub.com/acme/repo.git/?ref=main#checkout ';
    const second = {...first, repositoryUrl: 'https://github.com/changed/repo.git'};

    expect(await savePendingCheckoutRenewalSubject(first)).toBe(true);
    expect(await savePendingCheckoutRenewalSubject(second)).toBe(false);
    expect(await loadCheckoutRenewalSubject(fixture.step.id)).toBeNull();

    await withTransaction((tx) =>
      insertRunningStepAttempt(
        {jobExecutionId: fixture.execution.id, stepId: fixture.step.id, attempt: 1},
        tx,
      ),
    );
    await withTransaction((tx) =>
      finishStepAttempt(
        {stepId: fixture.step.id, attempt: 1, status: 'succeeded', logOutcome: 'drained'},
        tx,
      ),
    );
    await db().update(steps).set({status: 'succeeded'}).where(eq(steps.id, fixture.step.id));

    expect(await loadCheckoutRenewalSubject(fixture.step.id)).toEqual({
      repositoryUrl: 'https://github.com/acme/repo.git',
      connectionId: first.connectionId,
      externalRepositoryId: first.externalRepositoryId,
      permissions: first.permissions,
      stepId: fixture.step.id,
      attempt: 1,
    });
    const [stored] = await db()
      .select()
      .from(checkoutRenewalSubjects)
      .where(eq(checkoutRenewalSubjects.stepId, fixture.step.id));
    expect(stored?.status).toBe('promoted');
  });

  test('selects the current attempt after a retry', async () => {
    const fixture = await checkoutFixture();
    const first = subject(fixture);
    expect(await savePendingCheckoutRenewalSubject(first)).toBe(true);
    await withTransaction((tx) =>
      insertRunningStepAttempt(
        {jobExecutionId: fixture.execution.id, stepId: fixture.step.id, attempt: 1},
        tx,
      ),
    );
    await withTransaction((tx) =>
      finishStepAttempt(
        {stepId: fixture.step.id, attempt: 1, status: 'succeeded', logOutcome: 'drained'},
        tx,
      ),
    );
    await db().update(steps).set({status: 'succeeded'}).where(eq(steps.id, fixture.step.id));

    await withTransaction((tx) =>
      rewindStepsToPending({jobExecutionId: fixture.execution.id, fromPosition: 1}, tx),
    );
    await db().update(steps).set({status: 'running'}).where(eq(steps.id, fixture.step.id));
    const retry = subject(fixture, 2);
    retry.repositoryUrl = 'https://gitea.example/acme/repo.git';
    expect(await savePendingCheckoutRenewalSubject(retry)).toBe(true);
    await withTransaction((tx) =>
      insertRunningStepAttempt(
        {jobExecutionId: fixture.execution.id, stepId: fixture.step.id, attempt: 2},
        tx,
      ),
    );
    await withTransaction((tx) =>
      finishStepAttempt(
        {stepId: fixture.step.id, attempt: 2, status: 'succeeded', logOutcome: 'drained'},
        tx,
      ),
    );
    await db().update(steps).set({status: 'succeeded'}).where(eq(steps.id, fixture.step.id));

    expect(await loadCheckoutRenewalSubject(fixture.step.id)).toMatchObject({
      repositoryUrl: retry.repositoryUrl,
      attempt: 2,
    });
  });

  test.each([
    false,
    true,
  ])('does not expose a subject for a %s checkout attempt that does not succeed', async (persistCredentials) => {
    const fixture = await checkoutFixture(persistCredentials);
    const pending = subject(fixture);
    expect(await savePendingCheckoutRenewalSubject(pending)).toBe(persistCredentials);
    await withTransaction((tx) =>
      insertRunningStepAttempt(
        {jobExecutionId: fixture.execution.id, stepId: fixture.step.id, attempt: 1},
        tx,
      ),
    );
    if (persistCredentials) {
      await withTransaction((tx) =>
        finishStepAttempt(
          {stepId: fixture.step.id, attempt: 1, status: 'failed', logOutcome: 'drained'},
          tx,
        ),
      );
    }

    expect(await loadCheckoutRenewalSubject(fixture.step.id)).toBeNull();
  });

  test('fails closed for a stale promoted subject', async () => {
    const fixture = await checkoutFixture();
    const pending = subject(fixture);
    expect(await savePendingCheckoutRenewalSubject(pending)).toBe(true);
    await withTransaction((tx) =>
      insertRunningStepAttempt(
        {jobExecutionId: fixture.execution.id, stepId: fixture.step.id, attempt: 1},
        tx,
      ),
    );
    await withTransaction((tx) =>
      finishStepAttempt(
        {stepId: fixture.step.id, attempt: 1, status: 'succeeded', logOutcome: 'drained'},
        tx,
      ),
    );
    await db().update(steps).set({status: 'succeeded'}).where(eq(steps.id, fixture.step.id));
    await db()
      .update(steps)
      .set({currentAttempt: 2, status: 'pending'})
      .where(eq(steps.id, fixture.step.id));

    expect(await loadCheckoutRenewalSubject(fixture.step.id)).toBeNull();
    expect(
      await withTransaction((tx) =>
        promoteCheckoutRenewalSubject({stepId: fixture.step.id, attempt: 1}, tx),
      ),
    ).toBe(false);
  });
});
