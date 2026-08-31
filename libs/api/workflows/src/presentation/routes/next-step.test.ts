import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import {closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {eq} from 'drizzle-orm';
import {JobNotFoundError} from '#core/errors.js';
import {recordStepResult as recordJobExecutionStepResult} from '#core/job-execution.js';
import {db} from '#db/db.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {
  getFirstJobExecutionByJobId,
  getJobById,
  getStepsByJobId,
  getWorkflowRunByAttemptId,
} from '#db/workflow-runs.js';
import {insertRunningJobLease, mintActiveLeaseToken} from '#test/fixtures/active-lease-token.js';
import {agentTestClient} from '#test/fixtures/agent-inter-module.js';
import {workflowsTestAuthClient} from '#test/fixtures/auth-inter-module.js';
import {arrangeJobWithSteps} from '#test/fixtures/job-with-steps.js';
import {
  fakeLeaseTokenAuthMethod,
  getLeaseTokenClaims,
  mintLeaseToken,
} from '#test/fixtures/lease-token.js';
import {projectsTestClient} from '#test/fixtures/projects-inter-module.js';
import {
  runnersTestClient,
  setRunnerToolCapabilities as setTestRunnerToolCapabilities,
} from '#test/fixtures/runners-inter-module.js';
import {createTestSecretsClient} from '#test/fixtures/secrets-inter-module.js';
import {createLeaseTokenRouteGroup} from './index.js';

const URL = '/runs/jobs/current/steps/next';

async function recordStepResult(
  params: Omit<Parameters<typeof recordJobExecutionStepResult>[0], 'jobExecutionId'> & {
    jobId: string;
  },
) {
  const steps = await getStepsByJobId(params.jobId);
  const step = steps.find((candidate) => candidate.id === params.stepId);
  if (!step) throw new JobNotFoundError(params.jobId);
  const {jobId: _jobId, ...rest} = params;
  return recordJobExecutionStepResult({...rest, jobExecutionId: step.jobExecutionId});
}

function setRunnerToolCapabilities(
  runnerSessionId: string,
  capabilities: {harnesses: {pi?: {tools: string[]}; claude?: {tools: string[]}}},
): void {
  setTestRunnerToolCapabilities(runnerSessionId, {capabilities, reportFresh: true});
}

const annotationWrites = vi.fn<AnnotationsInterModuleClient['replaceOrRemoveAnnotation']>();
const annotationsTestClient: AnnotationsInterModuleClient = {
  replaceOrRemoveAnnotation: annotationWrites.mockResolvedValue({}),
};

describe('POST /runs/jobs/current/steps/next', () => {
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

  describe('lease-token auth', () => {
    test('rejects a request without an Authorization header', async () => {
      const res = await app.inject({method: 'POST', url: URL});

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthorized');
    });

    test('rejects a non-bearer Authorization header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: URL,
        headers: {authorization: 'Token abc'},
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthorized');
    });

    test('rejects a garbage token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: URL,
        headers: {authorization: 'Bearer not-a-token'},
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthorized');
    });
  });

  test('returns the lowest-position pending step and marks it running', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(3);
    const token = await mintActiveLeaseToken({jobId});
    const lease = getLeaseTokenClaims(token);
    if (!lease) throw new Error('Expected minted lease token to verify');
    const getLeaseState = vi.spyOn(runnersTestClient, 'getLeaseState');

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(getLeaseState).toHaveBeenCalledWith({
      jobId: lease.jobId,
      jobExecutionId: lease.jobExecutionId,
      runnerSessionId: lease.runnerSessionId,
    });
    const body = res.json();
    expect(body.kind).toBe('step');
    expect(body.step.id).toBe(steps[0]?.id);
    expect(body.step.status).toBe('running');
    expect(body.lease_token).toEqual(expect.any(String));
    const scopedLease = getLeaseTokenClaims(body.lease_token);
    expect(scopedLease).toMatchObject({
      jobId,
      jobExecutionId: steps[0]?.jobExecutionId,
      currentStepId: steps[0]?.id,
      currentStepAttempt: 1,
    });
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('running');
    expect(after[1]?.status).toBe('pending');
  });

  test('re-delivers the in-flight step on a retried pull', async () => {
    const {jobId} = await arrangeJobWithSteps(3);
    const token = await mintActiveLeaseToken({jobId});
    const first = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    const second = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().step.id).toBe(first.json().step.id);
    const running = (await getStepsByJobId(jobId)).filter((s) => s.status === 'running');
    expect(running).toHaveLength(1);
  });

  test('returns the tool wait protocol and keeps one queued invocation', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const step = steps[0];
    if (!step) throw new Error('Expected a tool step');
    await db()
      .update(stepsTable)
      .set({
        type: 'tool',
        config: {
          tool: {
            connection_id: 'connection-1',
            id: 'issue_read',
            input_schema: {type: 'object', additionalProperties: false},
            with: {},
          },
        },
        configPlan: null,
      })
      .where(eq(stepsTable.id, step.id));
    const token = await mintActiveLeaseToken({jobId});
    const headers = {authorization: `Bearer ${token}`};

    const first = await app.inject({method: 'POST', url: URL, headers});
    const second = await app.inject({method: 'POST', url: URL, headers});

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({kind: 'wait', retry_after_ms: 1000});
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({kind: 'wait', retry_after_ms: 1000});
  });

  test('writes the tool capability warning only on fresh dispatch', async () => {
    annotationWrites.mockClear();
    const {jobId, steps} = await arrangeJobWithSteps(1);
    await db()
      .update(stepsTable)
      .set({
        type: 'agent',
        config: {
          harness: 'pi',
          provider: 'anthropic',
          model: 'claude-opus-4-8',
          thinking: 'high',
          tools: ['read', 'web_search'],
          prompt: 'Fix it.',
        },
      })
      .where(eq(stepsTable.id, steps[0]?.id as string));
    const token = await mintActiveLeaseToken({jobId});
    const lease = getLeaseTokenClaims(token);
    if (!lease) throw new Error('Expected minted lease token to verify');
    setRunnerToolCapabilities(lease.runnerSessionId, {harnesses: {pi: {tools: ['read']}}});

    const first = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });
    const second = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(annotationWrites).toHaveBeenCalledTimes(1);
    expect(annotationWrites).toHaveBeenCalledWith(
      expect.objectContaining({
        jobExecutionId: lease.jobExecutionId,
        annotation: expect.objectContaining({op: 'replace'}),
      }),
    );
  });

  test('returns 404 for a valid token without an active lease', async () => {
    const token = await mintLeaseToken({
      jobId: crypto.randomUUID(),
      jobExecutionId: crypto.randomUUID(),
    });

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('lease-not-active');
  });

  test('returns 404 when the lease token is no longer the active job lease', async () => {
    const {jobId} = await arrangeJobWithSteps(1);
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
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('lease-not-active');
  });

  test('reports {done, succeeded} once every step succeeded', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintActiveLeaseToken({jobId});
    for (const step of steps) {
      await app.inject({method: 'POST', url: URL, headers: {authorization: `Bearer ${token}`}});
      await recordStepResult({jobId, stepId: step.id, status: 'succeeded'});
    }

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({kind: 'done', status: 'succeeded'});
  });

  test('reports {done, failed} after a failed step skips the default-gated rest', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintActiveLeaseToken({jobId});
    await app.inject({method: 'POST', url: URL, headers: {authorization: `Bearer ${token}`}});
    await recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'failed'});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({kind: 'done', status: 'failed'});
  });

  test('concurrent pulls hand out the same step exactly once', async () => {
    const {jobId} = await arrangeJobWithSteps(3);
    const token = await mintActiveLeaseToken({jobId});

    const responses = await Promise.all(
      Array.from({length: 5}, () =>
        app.inject({method: 'POST', url: URL, headers: {authorization: `Bearer ${token}`}}),
      ),
    );

    const ids = responses.map((res) => {
      expect(res.statusCode).toBe(200);
      return res.json().step.id;
    });
    expect(new Set(ids).size).toBe(1);
    const running = (await getStepsByJobId(jobId)).filter((s) => s.status === 'running');
    expect(running).toHaveLength(1);
  });

  test("returns the step's current attempt so the runner can echo it", async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    // Simulate a durable restart having bumped the first step's current attempt.
    await db()
      .update(stepsTable)
      .set({currentAttempt: 2})
      .where(eq(stepsTable.id, steps[0]?.id as string));
    const token = await mintActiveLeaseToken({jobId});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.attempt).toBe(2);
    const scopedLease = getLeaseTokenClaims(body.lease_token);
    expect(scopedLease?.currentStepId).toBe(steps[0]?.id);
    expect(scopedLease?.currentStepAttempt).toBe(body.attempt);
  });
});
