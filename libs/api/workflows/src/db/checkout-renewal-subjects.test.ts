import {eq} from 'drizzle-orm';
import {normalizeRepositoryUrl} from '#core/entities/checkout-renewal-subject.js';
import {CheckoutRepositoryUrlInvalidError} from '#core/errors.js';
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
  bulkUpdateStepStatuses,
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

async function checkoutFixture(
  persistCredentials = true,
  permissions: {contents: 'read' | 'write'} | null = {contents: 'write'},
) {
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
  if (permissions === null) {
    const checkoutConfig = {...(step.config.checkout as Record<string, unknown>)};
    delete checkoutConfig.permissions;
    await db()
      .update(steps)
      .set({config: {...step.config, checkout: checkoutConfig}})
      .where(eq(steps.id, step.id));
  }

  return {run, job, execution, step};
}

function subject(fixture: Awaited<ReturnType<typeof checkoutFixture>>, attempt = 1) {
  return {
    repositoryUrl: 'https://github.com/acme/repo',
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
  test('normalizes repository URLs and rejects credentials or invalid values', () => {
    expect(normalizeRepositoryUrl('git@GitHub.com:acme/repo.git/?ref=main#checkout')).toBe(
      'git@github.com:acme/repo',
    );
    expect(normalizeRepositoryUrl('HTTPS://GitHub.com:443/acme/repo.git/?ref=main#checkout')).toBe(
      'https://github.com/acme/repo',
    );
    expect(normalizeRepositoryUrl('https://github.com:443/acme/repo')).toBe(
      'https://github.com/acme/repo',
    );
    expect(normalizeRepositoryUrl('git@GITHUB.COM:acme/repo')).toBe('git@github.com:acme/repo');
    expect(normalizeRepositoryUrl('https://github.com/owner/.git')).toBe(
      'https://github.com/owner',
    );
    expect(() => normalizeRepositoryUrl('https://user:secret@github.com/acme/repo')).toThrow(
      CheckoutRepositoryUrlInvalidError,
    );
    expect(() => normalizeRepositoryUrl('user:secret@github.com:acme/repo')).toThrow(
      CheckoutRepositoryUrlInvalidError,
    );
    expect(() => normalizeRepositoryUrl('user:secret/withslash@github.com:acme/repo')).toThrow(
      CheckoutRepositoryUrlInvalidError,
    );
    expect(() => normalizeRepositoryUrl('not-a-repository-url')).toThrow(
      CheckoutRepositoryUrlInvalidError,
    );
  });

  test('promotes one frozen subject after the matching attempt succeeds', async () => {
    const fixture = await checkoutFixture();
    const first = subject(fixture);
    first.repositoryUrl = ' HTTPS://GitHub.com/acme/repo.git/?ref=main#checkout ';
    const second = {...first, repositoryUrl: 'https://github.com/changed/repo.git'};

    expect(await savePendingCheckoutRenewalSubject(first)).toBe(true);
    expect(await savePendingCheckoutRenewalSubject({...first})).toBe(true);
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
      repositoryUrl: 'https://github.com/acme/repo',
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

  test('uses read permissions when the checkout omits permissions', async () => {
    const fixture = await checkoutFixture(true, null);
    const pending = {...subject(fixture), permissions: {contents: 'read' as const}};

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

    await expect(loadCheckoutRenewalSubject(fixture.step.id)).resolves.toMatchObject({
      permissions: {contents: 'read'},
    });
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
    retry.repositoryUrl = 'https://gitea.example/acme/repo';
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
    const stored = await db()
      .select()
      .from(checkoutRenewalSubjects)
      .where(eq(checkoutRenewalSubjects.stepId, fixture.step.id));
    expect(stored).toHaveLength(0);
  });

  test('discards pending subjects during a bulk terminalization', async () => {
    const fixture = await checkoutFixture();
    expect(await savePendingCheckoutRenewalSubject(subject(fixture))).toBe(true);

    await withTransaction((tx) =>
      bulkUpdateStepStatuses({jobExecutionId: fixture.execution.id, status: 'cancelled'}, tx),
    );

    const stored = await db()
      .select()
      .from(checkoutRenewalSubjects)
      .where(eq(checkoutRenewalSubjects.stepId, fixture.step.id));
    expect(stored).toHaveLength(0);
  });

  test('preserves a promoted subject when a later attempt fails', async () => {
    const fixture = await checkoutFixture();
    expect(await savePendingCheckoutRenewalSubject(subject(fixture))).toBe(true);
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
    expect(await savePendingCheckoutRenewalSubject(subject(fixture, 2))).toBe(true);
    await withTransaction((tx) =>
      insertRunningStepAttempt(
        {jobExecutionId: fixture.execution.id, stepId: fixture.step.id, attempt: 2},
        tx,
      ),
    );
    await withTransaction((tx) =>
      finishStepAttempt(
        {stepId: fixture.step.id, attempt: 2, status: 'failed', logOutcome: 'drained'},
        tx,
      ),
    );

    const stored = await db()
      .select()
      .from(checkoutRenewalSubjects)
      .where(eq(checkoutRenewalSubjects.stepId, fixture.step.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({attempt: 1, status: 'promoted'});
  });

  test('fails closed when a promoted subject is tampered with', async () => {
    const permissionsFixture = await checkoutFixture();
    expect(await savePendingCheckoutRenewalSubject(subject(permissionsFixture))).toBe(true);
    await withTransaction((tx) =>
      insertRunningStepAttempt(
        {
          jobExecutionId: permissionsFixture.execution.id,
          stepId: permissionsFixture.step.id,
          attempt: 1,
        },
        tx,
      ),
    );
    await withTransaction((tx) =>
      finishStepAttempt(
        {
          stepId: permissionsFixture.step.id,
          attempt: 1,
          status: 'succeeded',
          logOutcome: 'drained',
        },
        tx,
      ),
    );
    await db()
      .update(steps)
      .set({status: 'succeeded'})
      .where(eq(steps.id, permissionsFixture.step.id));
    await db()
      .update(checkoutRenewalSubjects)
      .set({permissionsContents: 'read'})
      .where(eq(checkoutRenewalSubjects.stepId, permissionsFixture.step.id));
    expect(await loadCheckoutRenewalSubject(permissionsFixture.step.id)).toBeNull();

    const urlFixture = await checkoutFixture();
    expect(await savePendingCheckoutRenewalSubject(subject(urlFixture))).toBe(true);
    await withTransaction((tx) =>
      insertRunningStepAttempt(
        {jobExecutionId: urlFixture.execution.id, stepId: urlFixture.step.id, attempt: 1},
        tx,
      ),
    );
    await withTransaction((tx) =>
      finishStepAttempt(
        {stepId: urlFixture.step.id, attempt: 1, status: 'succeeded', logOutcome: 'drained'},
        tx,
      ),
    );
    await db().update(steps).set({status: 'succeeded'}).where(eq(steps.id, urlFixture.step.id));
    await db()
      .update(checkoutRenewalSubjects)
      .set({repositoryUrl: 'https://github.com/acme/repo/'})
      .where(eq(checkoutRenewalSubjects.stepId, urlFixture.step.id));
    expect(await loadCheckoutRenewalSubject(urlFixture.step.id)).toBeNull();
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
