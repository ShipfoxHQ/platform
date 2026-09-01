import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  STEP_ERROR_MESSAGE_MAX_LENGTH,
  workflowExecutionStepsResponseSchema,
  workflowJobDetailResponseSchema,
  workflowJobExecutionSummariesResponseSchema,
  workflowStepAttemptSummariesResponseSchema,
} from '@shipfox/api-workflows-dto';
import {eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {db} from '#db/db.js';
import {stepAttempts} from '#db/schema/step-attempts.js';
import {createHighCardinalityWorkflowRun} from '#test/index.js';
import {getJobDetailRoute} from './get-job-detail.js';
import {listExecutionStepsRoute} from './list-execution-steps.js';
import {listJobExecutionsRoute} from './list-job-executions.js';
import {listStepAttemptsRoute} from './list-step-attempts.js';

const getProjectById = vi.fn();
const projects = {
  getProjectById,
  requireProjectForWorkspace: vi.fn(),
} as unknown as ProjectsModuleClient;

describe('selected workflow job routes', () => {
  let app: FastifyInstance;
  let workspaceId: string;

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
    app.get('/api/workflows/runs/jobs/:jobId', getJobDetailRoute(projects));
    app.get('/api/workflows/runs/jobs/:jobId/executions', listJobExecutionsRoute(projects));
    app.get(
      '/api/workflows/runs/jobs/:jobId/executions/:executionId/steps',
      listExecutionStepsRoute(projects),
    );
    app.get('/api/workflows/runs/steps/:stepId/attempts', listStepAttemptsRoute(projects));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
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

  test('returns a schema-valid selected job with the active execution', async () => {
    const fixture = await createFixture();

    const response = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${fixture.jobIds[0]}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(workflowJobDetailResponseSchema.safeParse(body).success).toBe(true);
    expect(body.workflow_run_id).toBe(fixture.run.id);
    expect(body.workflow_run_attempt).toBe(1);
    expect(body.job.id).toBe(fixture.jobIds[0]);
    expect(body.selected_execution.id).toBe(fixture.executionIds[0]);
    expect(body.selected_execution.steps.total).toBe(2);
    expect(body.selected_execution.steps.items[0].attempts.total).toBe(2);
    expect(body.selected_execution).not.toHaveProperty('runner');
    expect(body.selected_execution.steps.items[0]).not.toHaveProperty('config');
  });

  test('paginates execution, step, and step-attempt summaries', async () => {
    const fixture = await createFixture({
      executionsPerJob: 3,
      stepsPerExecution: 3,
      attemptsPerStep: 3,
    });
    const jobId = fixture.jobIds[0] as string;
    const executionId = fixture.executionIds[0] as string;
    const stepId = fixture.stepIds[0] as string;

    const executions = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}/executions?limit=2`,
    });
    expect(executions.statusCode).toBe(200);
    expect(workflowJobExecutionSummariesResponseSchema.safeParse(executions.json()).success).toBe(
      true,
    );
    expect(executions.json().items.map((item: {sequence: number}) => item.sequence)).toEqual([
      3, 2,
    ]);
    expect(executions.json().total).toBe(3);

    const executionContinuation = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}/executions?limit=2&cursor=${executions.json().next_cursor}`,
    });
    expect(executionContinuation.statusCode).toBe(200);
    expect(
      executionContinuation.json().items.map((item: {sequence: number}) => item.sequence),
    ).toEqual([1]);
    expect(executionContinuation.json()).not.toHaveProperty('total');

    const steps = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}/executions/${executionId}/steps?limit=2`,
    });
    expect(steps.statusCode).toBe(200);
    expect(workflowExecutionStepsResponseSchema.safeParse(steps.json()).success).toBe(true);
    expect(steps.json().items.map((item: {position: number}) => item.position)).toEqual([0, 1]);
    expect(steps.json().total).toBe(3);

    const attempts = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/steps/${stepId}/attempts?limit=2`,
    });
    expect(attempts.statusCode).toBe(200);
    expect(workflowStepAttemptSummariesResponseSchema.safeParse(attempts.json()).success).toBe(
      true,
    );
    expect(attempts.json().items.map((item: {attempt: number}) => item.attempt)).toEqual([3, 2]);
    expect(attempts.json().total).toBe(3);
  });

  test('bounds embedded attempt previews and sanitizes legacy error and gate payloads', async () => {
    const fixture = await createFixture({attemptsPerStep: 12});
    const stepId = fixture.stepIds[0] as string;
    const newestAttemptId = fixture.stepAttemptIds[11] as string;
    await db()
      .update(stepAttempts)
      .set({
        error: {message: 'x'.repeat(STEP_ERROR_MESSAGE_MAX_LENGTH + 1)},
        gateResult: {legacy: 'payload'},
      })
      .where(eq(stepAttempts.id, newestAttemptId));

    const detail = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${fixture.jobIds[0]}`,
    });
    const body = detail.json();
    const embeddedAttempts = body.selected_execution.steps.items[0].attempts;

    expect(detail.statusCode).toBe(200);
    expect(embeddedAttempts.items).toHaveLength(10);
    expect(embeddedAttempts.items.map((item: {attempt: number}) => item.attempt)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
    ]);
    expect(embeddedAttempts.items[0].error.message).toHaveLength(STEP_ERROR_MESSAGE_MAX_LENGTH);
    expect(embeddedAttempts.items[0].gate_result).toEqual({kind: 'unknown'});
    expect(embeddedAttempts.next_cursor).toEqual(expect.any(String));

    const continuation = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/steps/${stepId}/attempts?cursor=${embeddedAttempts.next_cursor}`,
    });
    expect(continuation.statusCode).toBe(200);
    expect(continuation.json().items.map((item: {attempt: number}) => item.attempt)).toEqual([
      2, 1,
    ]);
    expect(continuation.json()).not.toHaveProperty('total');
  });

  test('masks wrong ancestry and malformed cursors as stable API errors', async () => {
    const fixture = await createFixture({jobs: 2, executionsPerJob: 1});
    const jobId = fixture.jobIds[0] as string;

    const wrongExecution = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}/executions/${fixture.executionIds[1]}/steps`,
    });
    const malformedCursor = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}/executions?cursor=not-a-cursor`,
    });

    expect(wrongExecution.statusCode).toBe(404);
    expect(wrongExecution.json().code).toBe('not-found');
    expect(malformedCursor.statusCode).toBe(400);
    expect(malformedCursor.json().code).toBe('invalid-cursor');
  });

  async function createFixture(
    options: Parameters<typeof createHighCardinalityWorkflowRun>[0] = {},
  ) {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 2,
      attemptsPerStep: 2,
      ...options,
    });
    workspaceId = fixture.run.workspaceId;
    return fixture;
  }
});
