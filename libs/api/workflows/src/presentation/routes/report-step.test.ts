import {closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {nextStepForJob} from '#core/job-execution.js';
import {
  getFirstJobExecutionByJobId,
  getJobById,
  getStepAttempts,
  getStepsByJobId,
  getWorkflowRunByAttemptId,
} from '#db/workflow-runs.js';
import {insertRunningJobLease, mintActiveLeaseToken} from '#test/fixtures/active-lease-token.js';
import {agentTestClient} from '#test/fixtures/agent-inter-module.js';
import {annotationsTestClient} from '#test/fixtures/annotations-inter-module.js';
import {workflowsTestAuthClient} from '#test/fixtures/auth-inter-module.js';
import {arrangeJobWithSteps} from '#test/fixtures/job-with-steps.js';
import {fakeLeaseTokenAuthMethod, mintLeaseToken} from '#test/fixtures/lease-token.js';
import {projectsTestClient} from '#test/fixtures/projects-inter-module.js';
import {runnersTestClient} from '#test/fixtures/runners-inter-module.js';
import {createTestSecretsClient} from '#test/fixtures/secrets-inter-module.js';
import {createLeaseTokenRouteGroup} from './index.js';

function reportUrl(stepId: string): string {
  return `/runs/jobs/current/steps/${stepId}/report`;
}

function reportPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return {...payload, log_outcome: 'drained'};
}

describe('POST /runs/jobs/current/steps/:stepId/report', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({
      auth: [fakeLeaseTokenAuthMethod],
      routes: [
        createLeaseTokenRouteGroup({
          agent: agentTestClient,
          annotations: annotationsTestClient,
          auth: workflowsTestAuthClient,
          integrations: {} as never,
          projects: projectsTestClient,
          runners: runnersTestClient,
          secrets: createTestSecretsClient(),
        }),
      ],
      swagger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await closeApp();
  });

  test('rejects a request without a lease token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: reportUrl(crypto.randomUUID()),
      payload: reportPayload({status: 'succeeded'}),
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
  });

  test('returns 404 when the lease token is no longer the active job lease', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    await nextStepForJob(jobId);
    const jobExecution = await getFirstJobExecutionByJobId(jobId);
    if (!jobExecution) throw new Error('Expected job execution to exist');
    const job = await getJobById(jobId);
    if (!job) throw new Error('Expected job to exist');
    const run = await getWorkflowRunByAttemptId(job.workflowRunAttemptId);
    if (!run) throw new Error('Expected workflow run to exist');
    await insertRunningJobLease({
      workspaceId: run.workspaceId,
      workflowRunId: run.id,
      workflowRunAttemptId: job.workflowRunAttemptId,
      jobId,
      jobExecutionId: jobExecution.id,
      projectId: run.projectId,
      runnerSessionId: crypto.randomUUID(),
    });
    const token = await mintLeaseToken({
      jobId,
      jobExecutionId: jobExecution.id,
      workflowRunId: run.id,
      workflowRunAttemptId: job.workflowRunAttemptId,
      projectId: run.projectId,
      workspaceId: run.workspaceId,
      runnerSessionId: crypto.randomUUID(),
    });

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({status: 'succeeded'}),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('lease-not-active');
  });

  test('records a succeeded mid-job step → {ok, cancel:false}', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintActiveLeaseToken({jobId});
    await nextStepForJob(jobId);

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({status: 'succeeded'}),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ok: true, cancel: false});
    expect((await getStepsByJobId(jobId))[0]?.status).toBe('succeeded');
  });

  test('finishing the job fully succeeded → {ok, cancel:false}', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const token = await mintActiveLeaseToken({jobId});
    await nextStepForJob(jobId);

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({status: 'succeeded'}),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ok: true, cancel: false});
  });

  test('a failed final report finishes the job → {ok, cancel:true}', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const token = await mintActiveLeaseToken({jobId});
    await nextStepForJob(jobId);

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({status: 'failed', error: {message: 'boom'}}),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ok: true, cancel: true});
  });

  test('a failed report leaves remaining steps dispatchable → {ok, cancel:false}', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(3);
    const token = await mintActiveLeaseToken({jobId});
    await nextStepForJob(jobId);

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({status: 'failed', error: {message: 'boom'}}),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ok: true, cancel: false});
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('failed');
    expect(after[1]?.status).toBe('pending');
    expect(after[2]?.status).toBe('pending');
  });

  test('persists the wire error snake_case fields as camelCase on the step row', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintActiveLeaseToken({jobId});
    await nextStepForJob(jobId);

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({
        status: 'failed',
        error: {message: 'boom', exit_code: 1, signal: 'SIGKILL'},
      }),
    });

    expect(res.statusCode).toBe(200);
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.error).toEqual({message: 'boom', exitCode: 1, signal: 'SIGKILL'});
    const [attempt] = await getStepAttempts(jobId);
    expect(attempt?.exitCode).toBe(1);
  });

  test('persists structured output on the attempt row', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const token = await mintActiveLeaseToken({jobId});
    await nextStepForJob(jobId);

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({
        status: 'succeeded',
        output: {artifact: 'dist/app.tgz'},
        exit_code: 0,
      }),
    });

    expect(res.statusCode).toBe(200);
    const [attempt] = await getStepAttempts(jobId);
    expect(attempt?.output).toEqual({artifact: 'dist/app.tgz'});
    expect(attempt?.exitCode).toBe(0);
  });

  test('turns a UTF-8 response overflow into a terminal failed attempt', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const token = await mintActiveLeaseToken({jobId});
    await nextStepForJob(jobId);
    const response = '😀'.repeat(3_000);

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({status: 'succeeded', response}),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ok: true, cancel: true});
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('failed');
    const [attempt] = await getStepAttempts(jobId);
    expect(attempt).toMatchObject({
      status: 'failed',
      output: null,
      response: null,
      error: {
        reason: 'step_result_too_large',
        field: 'response',
        retryable: false,
        limitBytes: 8 * 1024,
      },
    });
  });

  test('persists dedicated checkout details alongside user output', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const token = await mintActiveLeaseToken({jobId});
    await nextStepForJob(jobId);
    const checkout = {
      repository: 'https://github.com/acme/api.git',
      ref: 'refs/pull/412/head',
      commit: '9f2c000000000000000000000000000000000000',
      path: '/runner/workspace/job-1',
    };
    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({
        status: 'succeeded',
        output: {artifact: 'dist/app.tgz', checkout: 'user-value'},
        checkout,
        exit_code: 0,
      }),
    });
    expect(res.statusCode).toBe(200);
    const [attempt] = await getStepAttempts(jobId);
    expect(attempt?.output).toEqual({artifact: 'dist/app.tgz', checkout});
  });
  test('rejects a failed report without an error', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const token = await mintActiveLeaseToken({jobId});
    await nextStepForJob(jobId);

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({status: 'failed'}),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation-error');
  });

  test('rejects a succeeded report with an error', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const token = await mintActiveLeaseToken({jobId});
    await nextStepForJob(jobId);

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({status: 'succeeded', error: {message: 'should not be here'}}),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation-error');
  });

  test('a duplicate succeeded report is a no-op with the same response', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintActiveLeaseToken({jobId});
    await nextStepForJob(jobId);
    const first = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({status: 'succeeded'}),
    });

    const second = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({status: 'succeeded'}),
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('succeeded');
    expect(after[1]?.status).toBe('pending');
  });

  test('a late succeeded report after failure completion never downgrades and says cancel', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintActiveLeaseToken({jobId});
    await nextStepForJob(jobId);
    await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({status: 'failed', error: {message: 'boom'}}),
    });
    await nextStepForJob(jobId);

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({status: 'succeeded'}),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ok: true, cancel: true});
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('failed');
    expect(after[1]?.status).toBe('skipped');
  });

  test('rejects a result for a pending (never-dispatched) step with 409', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintActiveLeaseToken({jobId});

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({status: 'succeeded'}),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('step-not-running');
  });

  test('rejects an unknown stepId with 404', async () => {
    const {jobId} = await arrangeJobWithSteps(1);
    const token = await mintActiveLeaseToken({jobId});

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(crypto.randomUUID()),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({status: 'succeeded'}),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('step-not-found');
  });

  test("rejects another job's stepId with 404", async () => {
    const a = await arrangeJobWithSteps(1);
    const b = await arrangeJobWithSteps(1);
    const token = await mintActiveLeaseToken({jobId: a.jobId});
    await nextStepForJob(b.jobId);

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(b.steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({status: 'succeeded'}),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('step-not-found');
  });

  test('concurrent duplicate reports all succeed and land one result', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintActiveLeaseToken({jobId});
    await nextStepForJob(jobId);

    const responses = await Promise.all(
      Array.from({length: 5}, () =>
        app.inject({
          method: 'POST',
          url: reportUrl(steps[0]?.id as string),
          headers: {authorization: `Bearer ${token}`},
          payload: reportPayload({status: 'succeeded'}),
        }),
      ),
    );

    for (const res of responses) {
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ok: true, cancel: false});
    }
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('succeeded');
    expect(after[1]?.status).toBe('pending');
  });

  test('a report whose attempt is ahead of the current attempt → 409 step-attempt-ahead', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const token = await mintActiveLeaseToken({jobId});
    await nextStepForJob(jobId);

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: reportPayload({status: 'succeeded', attempt: 2}),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('step-attempt-ahead');
  });
});
