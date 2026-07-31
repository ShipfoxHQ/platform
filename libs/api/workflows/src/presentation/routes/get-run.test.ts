import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import {eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {JobNotFoundError} from '#core/errors.js';
import {
  nextStepForJob,
  recordStepResult as recordJobExecutionStepResult,
} from '#core/job-execution.js';
import {db} from '#db/db.js';
import * as dbIndex from '#db/index.js';
import {jobExecutions as jobExecutionsTable} from '#db/schema/job-executions.js';
import {jobs as jobsTable} from '#db/schema/jobs.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {
  createRerunWorkflowRun,
  createWorkflowRun,
  getJobExecutionsByJobId,
  getJobsByWorkflowRunId,
  getStepsByJobId,
  updateWorkflowRunStatus,
} from '#db/workflow-runs.js';
import {workflowModel} from '#test/index.js';
import {getRunRoute} from './get-run.js';

const projectAccessState = vi.hoisted(() => ({workspaceId: ''}));

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

const getProjectById = vi.fn();
const projects = {
  getProjectById,
  requireProjectForWorkspace: vi.fn(),
} as unknown as ProjectsModuleClient;

describe('GET /api/workflows/runs/:id', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let workspaceStatus: 'active' | 'deleted';

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.addHook('onRequest', (request, _reply, done) => {
      setUserContext(
        request,
        buildUserContext({
          userId: crypto.randomUUID(),
          email: 'user@example.com',
          memberships: [{workspaceId, role: 'admin', workspaceStatus}],
        }),
      );
      done();
    });
    app.get('/api/workflows/runs/:id', getRunRoute(projects));
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    workspaceStatus = 'active';
    projectAccessState.workspaceId = workspaceId;
    getProjectById.mockImplementation(({projectId}) =>
      Promise.resolve({
        project: {
          id: projectId,
          workspaceId,
          sourceConnectionId: crypto.randomUUID(),
          sourceExternalRepositoryId: `repo:${crypto.randomUUID()}`,
          name: 'Project',
        },
      }),
    );
  });

  test('returns 200 with run, jobs, and steps', async () => {
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();

    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: workflowModel({
        name: 'Test',
        jobs: {
          build: {steps: [{name: 'Install', run: 'npm install'}, {run: 'npm build'}]},
        },
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(run.id);
    expect(body).toMatchObject({name: 'Test', workflow_name: 'Test'});
    expect(body.number).toBe(run.number);
    expect(body.source_snapshot).toBeNull();
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].key).toBe('build');
    expect(body.jobs[0].name).toBeNull();
    expect(body.jobs[0].job_executions).toHaveLength(1);
    const steps = body.jobs[0].job_executions[0].steps;
    // Synthetic setup step at position 0, then the two user steps.
    expect(steps).toHaveLength(3);
    expect(steps[0].name).toBe('Set up job');
    expect(steps[1].name).toBe('Install');
    expect(steps[2].name).toBe('npm build');
    // Run timing fields flow through the read model (null on a fresh, unstamped run).
    expect(body).toMatchObject({latest_attempt: 1, started_at: null, finished_at: null});
    expect(body.jobs[0]).not.toHaveProperty('queued_at');
    expect(body.jobs[0]).not.toHaveProperty('started_at');
    expect(body.jobs[0]).not.toHaveProperty('finished_at');
  });

  test('does not aggregate latest_attempt for a first attempt without lineage', async () => {
    const latestAttemptSpy = vi.spyOn(dbIndex, 'getLatestAttempt');
    const run = await createWorkflowRun({
      workspaceId,
      projectId: crypto.randomUUID(),
      definitionId: crypto.randomUUID(),
      model: workflowModel({name: 'First attempt'}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().latest_attempt).toBe(1);
    expect(latestAttemptSpy).not.toHaveBeenCalled();
  });

  test('returns latest_attempt for a run lineage', async () => {
    const projectId = crypto.randomUUID();
    const source = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      model: workflowModel({name: 'Lineage'}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    await updateWorkflowRunStatus({workflowRunId: source.id, status: 'failed', expectedVersion: 1});
    const rerun = await createRerunWorkflowRun({
      workflowRunId: source.id,
      mode: 'all',
      actorUserId: crypto.randomUUID(),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${rerun.id}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().latest_attempt).toBe(2);
  });

  test('returns run source snapshot when present', async () => {
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();
    const sourceContent = `name: Source View
jobs:
  build:
    steps:
      - run: echo source
`;
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: workflowModel({name: 'Source View'}),
      sourceSnapshot: {content: sourceContent, format: 'yaml'},
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().source_snapshot).toEqual({content: sourceContent, format: 'yaml'});
  });

  test('returns source locations for authored steps and null for synthetic steps', async () => {
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();

    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: workflowModel({
        name: 'Source locations',
        jobs: {
          build: {
            steps: [
              {name: 'Install', run: 'npm install', sourceLocation: {startLine: 5, endLine: 6}},
              {run: 'npm test', sourceLocation: {startLine: 7, endLine: 10}},
            ],
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

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}`,
    });

    expect(res.statusCode).toBe(200);
    expect(
      res
        .json()
        .jobs[0].job_executions[0].steps.map(
          (step: {source_location: unknown}) => step.source_location,
        ),
    ).toEqual([null, {start_line: 5, end_line: 6}, {start_line: 7, end_line: 10}]);
  });

  test('exposes per-step error and skipped status after a failed per-step report', async () => {
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();

    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: workflowModel({
        name: 'Test',
        jobs: {build: {steps: [{run: 'a'}, {run: 'b'}, {run: 'c'}]}},
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });

    const runJobs = await getJobsByWorkflowRunId(run.id);
    const jobId = runJobs[0]?.id ?? '';
    const steps = await getStepsByJobId(jobId);

    // Drive the per-step path: step 1 succeeds, step 2 fails, step 3 is skipped
    // by the default gate on the follow-up pull.
    await nextStepForJob(jobId);
    await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'succeeded',
      exitCode: 0,
    });
    await nextStepForJob(jobId);
    await recordStepResult({
      jobId,
      stepId: steps[1]?.id as string,
      status: 'failed',
      error: {message: 'Command exited with code 1', exitCode: 1},
      exitCode: 1,
    });
    await nextStepForJob(jobId);

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // steps[0] is the setup step (reported succeeded above); the failed user step
    // follows. A failed step's error carries the server-derived category 'user'.
    const responseSteps = body.jobs[0].job_executions[0].steps as Array<{
      status: string;
      error: {message: string; exit_code?: number | null; category?: string} | null;
    }>;
    expect(responseSteps[0]?.status).toBe('succeeded');
    expect(responseSteps[0]?.error).toBeNull();
    expect(responseSteps[1]?.status).toBe('failed');
    expect(responseSteps[1]?.error).toEqual({
      message: 'Command exited with code 1',
      exit_code: 1,
      category: 'user',
    });
    expect(responseSteps[2]?.status).toBe('skipped');
    expect(responseSteps[2]?.error).toBeNull();
  });

  test('returns 404 for non-existent run', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${crypto.randomUUID()}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  test('returns 404 for inaccessible run', async () => {
    const detailSpy = vi.spyOn(dbIndex, 'getWorkflowRunDetail');
    const run = await createWorkflowRun({
      workspaceId,
      projectId: crypto.randomUUID(),
      definitionId: crypto.randomUUID(),
      model: workflowModel({name: 'Test'}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    getProjectById.mockRejectedValueOnce(
      new ClientError('Not a member of this workspace', 'forbidden', {status: 403}),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
    expect(detailSpy).not.toHaveBeenCalled();
  });

  test('preserves workspace-inactive for a deleted membership claim', async () => {
    workspaceStatus = 'deleted';
    const run = await createWorkflowRun({
      workspaceId,
      projectId: crypto.randomUUID(),
      definitionId: crypto.randomUUID(),
      model: workflowModel({name: 'Test'}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('workspace-inactive');
  });

  test('propagates unexpected errors from project access check', async () => {
    const run = await createWorkflowRun({
      workspaceId,
      projectId: crypto.randomUUID(),
      definitionId: crypto.randomUUID(),
      model: workflowModel({name: 'Test'}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    getProjectById.mockRejectedValueOnce(new Error('database connection lost'));

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}`,
    });

    expect(res.statusCode).toBe(500);
  });

  test('exposes step current_attempt and attempt history', async () => {
    const projectId = crypto.randomUUID();
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      model: workflowModel({
        name: 'Test',
        jobs: {build: {steps: [{run: 'a'}, {run: 'b'}]}},
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const jobId = (await getJobsByWorkflowRunId(run.id))[0]?.id as string;
    const steps = await getStepsByJobId(jobId);
    await nextStepForJob(jobId);
    await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'succeeded',
      exitCode: 0,
    });

    const res = await app.inject({method: 'GET', url: `/api/workflows/runs/${run.id}`});

    expect(res.statusCode).toBe(200);
    const [step0, step1] = res.json().jobs[0].job_executions[0].steps;
    expect(step0.current_attempt).toBe(1);
    expect(step0.attempts).toHaveLength(1);
    expect(step0.attempts[0]).toMatchObject({
      attempt: 1,
      status: 'succeeded',
      exit_code: 0,
      gate_result: {kind: 'none'},
      restart_feedback: null,
    });
    // A never-dispatched step has no attempt history yet.
    expect(step1.current_attempt).toBe(1);
    expect(step1.attempts).toEqual([]);
  });

  test('exposes server-derived outputs and responses in run detail', async () => {
    const projectId = crypto.randomUUID();
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      model: workflowModel({
        name: 'Test',
        jobs: {build: {steps: [{run: 'build'}]}},
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const job = (await getJobsByWorkflowRunId(run.id))[0];
    if (!job) throw new Error('Expected workflow job');
    const jobExecution = (await getJobExecutionsByJobId(job.id))[0];
    if (!jobExecution) throw new Error('Expected job execution');
    const steps = await getStepsByJobId(job.id);
    const setupId = steps[0]?.id as string;
    const buildId = steps[1]?.id as string;
    await db()
      .update(jobsTable)
      .set({outputs: {image_sha: 'sha-123'}})
      .where(eq(jobsTable.id, job.id));
    await db()
      .update(jobExecutionsTable)
      .set({outputs: {image_sha: 'sha-123', token: '***'}})
      .where(eq(jobExecutionsTable.id, jobExecution.id));
    await nextStepForJob(job.id);
    await recordStepResult({
      jobId: job.id,
      stepId: setupId,
      status: 'succeeded',
      exitCode: 0,
    });
    await nextStepForJob(job.id);
    await recordStepResult({
      jobId: job.id,
      stepId: buildId,
      status: 'succeeded',
      exitCode: 0,
      output: {image_sha: 'sha-123', token: '***'},
      response: 'Build complete',
    });

    const res = await app.inject({method: 'GET', url: `/api/workflows/runs/${run.id}`});

    expect(res.statusCode).toBe(200);
    const responseJob = res.json().jobs[0];
    const responseExecution = responseJob.job_executions[0];
    const responseBuildStep = responseExecution.steps[1];
    expect(responseJob.outputs).toEqual({image_sha: 'sha-123'});
    expect(responseExecution.outputs).toEqual({image_sha: 'sha-123', token: '***'});
    expect(responseBuildStep).toMatchObject({
      exit_code: 0,
      outputs: {image_sha: 'sha-123', token: '***'},
      response: 'Build complete',
      gate_result: {kind: 'none'},
    });
    expect(responseBuildStep.attempts[0]).toMatchObject({
      output: {image_sha: 'sha-123', token: '***'},
      outputs: {image_sha: 'sha-123', token: '***'},
      response: 'Build complete',
    });
  });

  test('exposes multiple ordered attempts for a restarted step', async () => {
    const projectId = crypto.randomUUID();
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      model: workflowModel({
        name: 'Test',
        jobs: {build: {steps: [{run: 'produce'}, {run: 'review'}]}},
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const jobId = (await getJobsByWorkflowRunId(run.id))[0]?.id as string;
    const steps = await getStepsByJobId(jobId);
    // steps[0] is the synthetic setup step; the user steps follow at 1..2.
    const setupId = steps[0]?.id as string;
    const producerId = steps[1]?.id as string;
    const reviewerId = steps[2]?.id as string;
    // reviewer gate: succeed only on exit 0; otherwise restart from producer.
    await db().update(stepsTable).set({key: 'producer'}).where(eq(stepsTable.id, producerId));
    await db()
      .update(stepsTable)
      .set({
        config: {
          run: 'review',
          gate: {
            success: {language: 'cel', check: 'syntax', source: 'step.exit_code == 0'},
            on_failure: {restart_from: 'producer'},
          },
        },
      })
      .where(eq(stepsTable.id, reviewerId));
    const runStep = async (stepId: string, exitCode: number) => {
      await nextStepForJob(jobId);
      await recordStepResult({
        jobId,
        stepId,
        status: exitCode === 0 ? 'succeeded' : 'failed',
        ...(exitCode === 0 ? {} : {error: {message: `exit ${exitCode}`}}),
        exitCode,
      });
    };
    await runStep(setupId, 0); // setup (position 0) succeeds first
    await runStep(producerId, 0); // producer attempt 1 succeeds
    await runStep(reviewerId, 1); // reviewer attempt 1 gate-fails → restart, both bumped to 2
    await runStep(producerId, 0); // producer attempt 2 succeeds
    await runStep(reviewerId, 0); // reviewer attempt 2 gate-passes → job done

    const res = await app.inject({method: 'GET', url: `/api/workflows/runs/${run.id}`});

    expect(res.statusCode).toBe(200);
    const [, producer, reviewer] = res.json().jobs[0].job_executions[0].steps;
    expect(producer.current_attempt).toBe(2);
    expect(producer.attempts.map((a: {attempt: number}) => a.attempt)).toEqual([1, 2]);
    expect(reviewer.current_attempt).toBe(2);
    const reviewerAttempts = reviewer.attempts as Array<{
      attempt: number;
      status: string;
      exit_code: number | null;
      gate_result: unknown;
      restart_feedback: string | null;
    }>;
    expect(reviewerAttempts.map((a) => a.attempt)).toEqual([1, 2]); // ordered by attempt
    expect(reviewerAttempts[0]?.status).toBe('failed');
    expect(reviewerAttempts[0]?.exit_code).toBe(1);
    expect(reviewerAttempts[0]?.gate_result).toEqual({
      kind: 'failed',
      passed: false,
      source: 'step.exit_code == 0',
      exit_code: 1,
    });
    expect(reviewerAttempts[0]?.restart_feedback).toBe('gate condition not met');
    expect(reviewerAttempts[1]?.status).toBe('succeeded');
    expect(reviewerAttempts[1]?.exit_code).toBe(0);
    expect(reviewerAttempts[1]?.gate_result).toEqual({
      kind: 'passed',
      passed: true,
      source: 'step.exit_code == 0',
      exit_code: 0,
    });
    expect(reviewerAttempts[1]?.restart_feedback).toBeNull();
  });
});
