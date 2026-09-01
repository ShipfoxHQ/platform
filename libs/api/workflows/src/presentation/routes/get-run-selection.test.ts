import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {db} from '#db/db.js';
import {
  createRerunWorkflowRun,
  createWorkflowRun,
  getJobExecutionsByJobId,
  getJobsByWorkflowRunId,
  getStepsByJobExecutionId,
  insertRunningStepAttempt,
  updateWorkflowRunStatus,
} from '#db/workflow-runs.js';
import {workflowModel} from '#test/index.js';
import {getRunSelectionRoute} from './get-run-selection.js';

const getProjectById = vi.fn();
const projects = {
  getProjectById,
  requireProjectForWorkspace: vi.fn(),
} as unknown as ProjectsModuleClient;

describe('GET /api/workflows/runs/:id/selection', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectId: string;

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
          memberships: [{workspaceId, role: 'admin', workspaceStatus: 'active'}],
        }),
      );
      done();
    });
    app.get('/api/workflows/runs/:id/selection', getRunSelectionRoute(projects));
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    getProjectById.mockReset();
    getProjectById.mockImplementation(({projectId: requestedProjectId}) =>
      Promise.resolve({
        project: {
          id: requestedProjectId,
          workspaceId,
          sourceConnectionId: crypto.randomUUID(),
          sourceExternalRepositoryId: `repo:${crypto.randomUUID()}`,
          name: 'Project',
        },
      }),
    );
  });

  test.each([
    ['job', (fixture: SelectionFixture) => ({job_id: fixture.sourceJob.id})],
    ['execution', (fixture: SelectionFixture) => ({job_execution_id: fixture.sourceExecution.id})],
    ['step', (fixture: SelectionFixture) => ({step_id: fixture.sourceStep.id})],
    ['step attempt', (fixture: SelectionFixture) => ({step_attempt_id: fixture.stepAttemptId})],
  ])('resolves ancestry from a %s identity', async (_depth, queryFor) => {
    const fixture = await createLineage();

    const response = await app.inject({
      method: 'GET',
      url: selectionUrl(fixture.run.id, queryFor(fixture)),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expectedSelection(fixture, _depth));
  });

  test('derives an older attempt from a step-only identity', async () => {
    const fixture = await createLineage();

    const response = await app.inject({
      method: 'GET',
      url: selectionUrl(fixture.run.id, {step_id: fixture.sourceStep.id}),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workflow_run_id: fixture.run.id,
      workflow_run_attempt: 1,
      step_id: fixture.sourceStep.id,
    });
  });

  test('returns the stable not-found response for a mismatched attempt', async () => {
    const fixture = await createLineage();

    const response = await app.inject({
      method: 'GET',
      url: selectionUrl(fixture.run.id, {step_id: fixture.sourceStep.id, attempt: 2}),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({code: 'not-found'});
  });

  test('rejects identities that cross run, attempt, job, execution, or step ancestry', async () => {
    const fixture = await createLineage();
    const otherRun = await createRun();
    const [otherJob] = await getJobsByWorkflowRunId(otherRun.id);
    if (!otherJob) throw new Error('Missing other job');
    const [otherExecution] = await getJobExecutionsByJobId(otherJob.id);
    if (!otherExecution) throw new Error('Missing other execution');
    const otherSteps = await getStepsByJobExecutionId(otherExecution.id);
    const otherStep = otherSteps.find((step) => step.sourceLocation !== null);
    if (!otherStep) throw new Error('Missing other step');

    const mismatchedSelections = [
      {job_id: fixture.sourceJob.id, job_execution_id: fixture.rerunExecution.id},
      {job_execution_id: fixture.sourceExecution.id, step_id: fixture.rerunStep.id},
      {step_id: fixture.sourceStep.id, job_id: otherJob.id},
      {step_id: fixture.sourceStep.id, job_execution_id: otherExecution.id},
      {step_attempt_id: fixture.stepAttemptId, step_id: otherStep.id},
    ];

    for (const query of mismatchedSelections) {
      const response = await app.inject({
        method: 'GET',
        url: selectionUrl(fixture.run.id, query),
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({code: 'not-found'});
    }
  });

  test('returns the stable not-found response for missing or inaccessible runs', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: selectionUrl(crypto.randomUUID(), {job_id: crypto.randomUUID()}),
    });
    const fixture = await createLineage();
    getProjectById.mockRejectedValueOnce(new ClientError('Forbidden', 'forbidden', {status: 403}));

    const inaccessible = await app.inject({
      method: 'GET',
      url: selectionUrl(fixture.run.id, {job_id: fixture.sourceJob.id}),
    });

    expect(missing.statusCode).toBe(404);
    expect(inaccessible.statusCode).toBe(404);
  });

  test('rejects a query without a nested identity', async () => {
    const fixture = await createLineage();

    const response = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${fixture.run.id}/selection?attempt=2`,
    });

    expect(response.statusCode).toBe(400);
  });

  async function createLineage(): Promise<SelectionFixture> {
    const sourceRun = await createRun();
    const [sourceJob] = await getJobsByWorkflowRunId(sourceRun.id);
    if (!sourceJob) throw new Error('Missing source job');
    const [sourceExecution] = await getJobExecutionsByJobId(sourceJob.id);
    if (!sourceExecution) throw new Error('Missing source execution');
    const sourceSteps = await getStepsByJobExecutionId(sourceExecution.id);
    const sourceStep = sourceSteps.find((step) => step.sourceLocation !== null);
    if (!sourceStep) throw new Error('Missing source step');
    const stepAttemptId = await db().transaction((tx) =>
      insertRunningStepAttempt(
        {
          jobExecutionId: sourceExecution.id,
          stepId: sourceStep.id,
          attempt: 1,
        },
        tx,
      ),
    );
    if (!stepAttemptId) throw new Error('Missing source step attempt');

    await updateWorkflowRunStatus({
      workflowRunId: sourceRun.id,
      status: 'failed',
      expectedVersion: 1,
    });
    const run = await createRerunWorkflowRun({
      workflowRunId: sourceRun.id,
      mode: 'all',
      actorUserId: crypto.randomUUID(),
    });
    const [rerunJob] = await getJobsByWorkflowRunId(run.id);
    if (!rerunJob) throw new Error('Missing rerun job');
    const [rerunExecution] = await getJobExecutionsByJobId(rerunJob.id);
    if (!rerunExecution) throw new Error('Missing rerun execution');
    const rerunSteps = await getStepsByJobExecutionId(rerunExecution.id);
    const rerunStep = rerunSteps.find((step) => step.sourceLocation !== null);
    if (!rerunStep) throw new Error('Missing rerun step');

    return {
      run,
      sourceJob,
      sourceExecution,
      sourceStep,
      stepAttemptId,
      rerunExecution,
      rerunStep,
    };
  }

  function createRun() {
    return createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      model: workflowModel({
        name: 'Selection',
        jobs: {
          build: {
            steps: [
              {name: 'Install', run: 'npm install', sourceLocation: {startLine: 5, endLine: 6}},
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
  }
});

interface SelectionFixture {
  run: Awaited<ReturnType<typeof createWorkflowRun>>;
  sourceJob: Awaited<ReturnType<typeof getJobsByWorkflowRunId>>[number];
  sourceExecution: Awaited<ReturnType<typeof getJobExecutionsByJobId>>[number];
  sourceStep: Awaited<ReturnType<typeof getStepsByJobExecutionId>>[number];
  stepAttemptId: string;
  rerunExecution: Awaited<ReturnType<typeof getJobExecutionsByJobId>>[number];
  rerunStep: Awaited<ReturnType<typeof getStepsByJobExecutionId>>[number];
}

function selectionUrl(runId: string, query: Record<string, string | number>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) search.set(key, String(value));
  return `/api/workflows/runs/${runId}/selection?${search.toString()}`;
}

function expectedSelection(fixture: SelectionFixture, depth: string) {
  const includesExecution = depth !== 'job';
  const includesStep = depth === 'step' || depth === 'step attempt';
  const includesStepAttempt = depth === 'step attempt';

  return {
    workflow_run_id: fixture.run.id,
    workflow_run_attempt: 1,
    job_id: fixture.sourceJob.id,
    job_execution_id: includesExecution ? fixture.sourceExecution.id : null,
    step_id: includesStep ? fixture.sourceStep.id : null,
    step_attempt_id: includesStepAttempt ? fixture.stepAttemptId : null,
    step_attempt: includesStepAttempt ? 1 : null,
    source_location: includesStep ? {start_line: 5, end_line: 6} : null,
  };
}
