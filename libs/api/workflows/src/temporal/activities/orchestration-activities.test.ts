import {MAX_LISTENER_FILTER_SNAPSHOT_BYTES} from '@shipfox/api-workflows-dto';
import {ApplicationFailure} from '@temporalio/common';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {
  createWorkflowRun,
  getJobExecutionsByJobId,
  getJobsByWorkflowRunId,
  updateJobExecutionStatus,
} from '#db/index.js';
import {jobs} from '#db/schema/jobs.js';
import {createTestSecretsClient} from '#test/fixtures/secrets-inter-module.js';
import {stripSetupStep} from '#test/fixtures/strip-setup-step.js';
import {workflowModel} from '#test/index.js';
import {
  activateJobListenerActivity,
  queueJobExecutionActivity,
  resolveLeaseExpiredJobExecutionActivity,
  setJobStatus,
} from './orchestration-activities.js';

let workspaceId: string;
let projectId: string;
let definitionId: string;
const secrets = createTestSecretsClient();

beforeEach(() => {
  workspaceId = crypto.randomUUID();
  projectId = crypto.randomUUID();
  definitionId = crypto.randomUUID();
});

describe('resolveLeaseExpiredJobExecutionActivity', () => {
  async function seedRunningJob(stepCount: number) {
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: workflowModel({
        jobs: {build: {steps: Array.from({length: stepCount}, (_, i) => ({run: `step${i + 1}`}))}},
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const jobId = (await getJobsByWorkflowRunId(run.id))[0]?.id as string;
    const jobExecutionId = (await getJobExecutionsByJobId(jobId))[0]?.id as string;
    const running = await updateJobExecutionStatus({
      jobExecutionId,
      status: 'running',
      expectedVersion: 1,
    });
    return {jobId, jobExecutionId, runningVersion: running.version};
  }

  test('a malformed job (no steps) fails non-retryably so it never loops to the backstop', async () => {
    const {jobId, jobExecutionId, runningVersion} = await seedRunningJob(0);
    // createWorkflowRun always prepends the synthetic setup step, so strip it to
    // reproduce a genuinely stepless (malformed) job.
    await stripSetupStep(jobId);

    const error = await resolveLeaseExpiredJobExecutionActivity(
      {jobExecutionId, expectedVersion: runningVersion},
      secrets,
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApplicationFailure);
    expect((error as ApplicationFailure).nonRetryable).toBe(true);
  });

  test('a well-formed job resolves without raising', async () => {
    const {jobExecutionId, runningVersion} = await seedRunningJob(2);

    const result = await resolveLeaseExpiredJobExecutionActivity(
      {jobExecutionId, expectedVersion: runningVersion},
      secrets,
    );

    expect(result.status).toBe('failed');
  });
});

describe('queueJobExecutionActivity', () => {
  test('a missing execution fails non-retryably', async () => {
    const error = await queueJobExecutionActivity({
      jobId: crypto.randomUUID(),
      jobExecutionId: crypto.randomUUID(),
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApplicationFailure);
    expect((error as ApplicationFailure).nonRetryable).toBe(true);
  });
});

describe('activateJobListenerActivity', () => {
  test('classifies an oversized filter snapshot as non-retryable', async () => {
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: workflowModel({
        jobs: {
          build: {steps: [{run: 'echo build'}]},
          listen: {
            needs: ['build'],
            listening: {
              on: [{source: 'github', event: 'pull_request', filter: 'jobs.build'}],
              onResolve: 'finish',
            },
            steps: [{run: 'echo listen'}],
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
    const runJobs = await getJobsByWorkflowRunId(run.id);
    const build = runJobs.find((job) => job.key === 'build');
    const listener = runJobs.find((job) => job.key === 'listen');
    if (!build || !listener) throw new Error('Expected listener fixture jobs');

    await db()
      .update(jobs)
      .set({outputs: {payload: 'x'.repeat(MAX_LISTENER_FILTER_SNAPSHOT_BYTES)}})
      .where(eq(jobs.id, build.id));

    const error = await activateJobListenerActivity({
      jobId: listener.id,
      expectedVersion: listener.version,
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApplicationFailure);
    expect((error as ApplicationFailure).nonRetryable).toBe(true);
    expect((error as ApplicationFailure).type).toBe('WorkflowExecutionPayloadTooLargeError');
  });
});

describe('setJobStatus', () => {
  test('default-gate skipped jobs record an evaluation trace', async () => {
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: workflowModel({
        jobs: {
          build: {steps: [{run: 'npm run build'}]},
        },
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const [job] = await getJobsByWorkflowRunId(run.id);
    if (!job) throw new Error('Expected job');

    await setJobStatus({
      jobId: job.id,
      status: 'skipped',
      version: job.version,
      statusReason: 'default_gate_rejected',
    });

    const [skipped] = await getJobsByWorkflowRunId(run.id);
    expect(skipped?.evaluationTrace).toEqual([
      {
        expression: 'needs.all(n, n.status == "succeeded")',
        roots: ['needs'],
        fillTarget: 'job-activation',
        evaluatedAt: 'job-activation',
        value: 'false',
        field: 'job.default_gate',
      },
    ]);
  });
});
