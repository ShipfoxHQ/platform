import {eq} from 'drizzle-orm';
import {
  buildModel,
  conditionTrace,
  jobByKey,
  template,
  workflowRunAttemptId,
} from '#test/helpers/workflow-runs.js';
import {db} from '../db.js';
import {jobs} from '../schema/jobs.js';
import {createWorkflowRun, evaluateJobActivations, updateJobStatus} from '../workflow-runs.js';

describe('evaluateJobActivations', () => {
  const scope = {
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    definitionId: crypto.randomUUID(),
  };

  it('starts a failure-handling job when its dependency failed', async () => {
    const run = await createWorkflowRun({
      ...scope,
      name: 'failure handler',
      model: buildModel({
        jobs: {
          build: {steps: [{run: 'npm run build'}]},
          notify: {
            needs: 'build',
            if: 'jobs.build.status == "failed"',
            steps: [{run: './notify.sh'}],
          },
        },
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const build = await jobByKey(run.id, 'build');
    const notify = await jobByKey(run.id, 'notify');
    await updateJobStatus({
      jobId: build.id,
      status: 'failed',
      expectedVersion: build.version,
      statusReason: 'step_failed',
    });

    const result = await evaluateJobActivations({
      runAttemptId: await workflowRunAttemptId(run.id),
      jobs: [{jobId: notify.id, expectedVersion: notify.version}],
    });

    expect(result).toEqual([{kind: 'start-job', jobId: notify.id}]);
  });

  it('skips a failure-handling job when its dependency succeeded', async () => {
    const run = await createWorkflowRun({
      ...scope,
      name: 'handler skipped',
      model: buildModel({
        jobs: {
          build: {steps: [{run: 'npm run build'}]},
          notify: {
            needs: 'build',
            if: 'jobs.build.status == "failed"',
            steps: [{run: './notify.sh'}],
          },
        },
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const build = await jobByKey(run.id, 'build');
    const notify = await jobByKey(run.id, 'notify');
    await updateJobStatus({
      jobId: build.id,
      status: 'succeeded',
      expectedVersion: build.version,
    });

    const result = await evaluateJobActivations({
      runAttemptId: await workflowRunAttemptId(run.id),
      jobs: [{jobId: notify.id, expectedVersion: notify.version}],
    });

    expect(result).toEqual([
      {kind: 'terminal-job', jobId: notify.id, status: 'skipped', jobVersion: expect.any(Number)},
    ]);
    const skipped = await jobByKey(run.id, 'notify');
    expect(skipped.status).toBe('skipped');
    expect(skipped.statusReason).toBe('condition_rejected');
    expect(skipped.evaluationTrace).toEqual([
      conditionTrace('job.if', 'jobs.build.status == "failed"', ['jobs'], false),
    ]);
  });

  it('evaluates fan-in needs aggregation and dependency outputs from persisted state', async () => {
    const run = await createWorkflowRun({
      ...scope,
      name: 'fan in',
      model: buildModel({
        jobs: {
          build: {steps: [{run: 'npm run build'}]},
          lint: {steps: [{run: 'npm run lint'}]},
          notify: {
            needs: ['build', 'lint'],
            if: 'needs.exists(n, n.status == "failed") && jobs.build.outputs.sha == "abc123"',
            steps: [{run: './notify.sh'}],
          },
        },
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const build = await jobByKey(run.id, 'build');
    const lint = await jobByKey(run.id, 'lint');
    const notify = await jobByKey(run.id, 'notify');
    await updateJobStatus({
      jobId: build.id,
      status: 'failed',
      expectedVersion: build.version,
      statusReason: 'step_failed',
    });
    await db()
      .update(jobs)
      .set({outputs: {sha: 'abc123'}})
      .where(eq(jobs.id, build.id));
    await updateJobStatus({
      jobId: lint.id,
      status: 'succeeded',
      expectedVersion: lint.version,
    });

    const result = await evaluateJobActivations({
      runAttemptId: await workflowRunAttemptId(run.id),
      jobs: [{jobId: notify.id, expectedVersion: notify.version}],
    });

    expect(result).toEqual([{kind: 'start-job', jobId: notify.id}]);
  });

  it('rehydrates typed dependency outputs before activation evaluation', async () => {
    const run = await createWorkflowRun({
      ...scope,
      name: 'typed dependency outputs',
      model: buildModel({
        jobs: {
          build: {
            steps: [{key: 'collect', run: 'npm run build'}],
            outputs: {
              count: template('steps.collect.outputs.count'),
              createdAt: template('run.created_at'),
            },
            outputTypes: {count: 'int', createdAt: 'timestamp'},
          },
          notify: {
            needs: 'build',
            if: 'jobs.build.outputs.count + 1 == 43 && jobs.build.outputs.createdAt < timestamp("2026-07-01T00:00:00Z")',
            steps: [{run: './notify.sh'}],
          },
        },
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const build = await jobByKey(run.id, 'build');
    const notify = await jobByKey(run.id, 'notify');
    await updateJobStatus({
      jobId: build.id,
      status: 'succeeded',
      expectedVersion: build.version,
    });
    await db()
      .update(jobs)
      .set({outputs: {count: 42, createdAt: '2026-06-30T12:00:00.000Z'}})
      .where(eq(jobs.id, build.id));

    const result = await evaluateJobActivations({
      runAttemptId: await workflowRunAttemptId(run.id),
      jobs: [{jobId: notify.id, expectedVersion: notify.version}],
    });

    expect(result).toEqual([{kind: 'start-job', jobId: notify.id}]);
  });

  it('records condition_errored when predicate evaluation fails closed', async () => {
    const run = await createWorkflowRun({
      ...scope,
      name: 'broken condition',
      model: buildModel({
        jobs: {
          build: {steps: [{run: 'npm run build'}]},
          notify: {
            needs: 'build',
            if: 'jobs.build.outputs.sha.missing == "abc123"',
            steps: [{run: './notify.sh'}],
          },
        },
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const build = await jobByKey(run.id, 'build');
    const notify = await jobByKey(run.id, 'notify');
    await updateJobStatus({
      jobId: build.id,
      status: 'succeeded',
      expectedVersion: build.version,
    });

    const result = await evaluateJobActivations({
      runAttemptId: await workflowRunAttemptId(run.id),
      jobs: [{jobId: notify.id, expectedVersion: notify.version}],
    });

    expect(result).toEqual([
      {kind: 'terminal-job', jobId: notify.id, status: 'skipped', jobVersion: expect.any(Number)},
    ]);
    const skipped = await jobByKey(run.id, 'notify');
    expect(skipped.statusReason).toBe('condition_errored');
    expect(skipped.evaluationTrace).toEqual([
      conditionTrace('job.if', 'jobs.build.outputs.sha.missing == "abc123"', ['jobs'], false, true),
    ]);
  });
});
