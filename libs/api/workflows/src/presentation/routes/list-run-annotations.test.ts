import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  workflowRunAnnotationsResponseSchema,
  workflowRunJobExplanationsResponseSchema,
} from '@shipfox/api-workflows-dto';
import {inArray} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {db} from '#db/db.js';
import {jobExecutions} from '#db/schema/job-executions.js';
import {jobs} from '#db/schema/jobs.js';
import {createHighCardinalityWorkflowRun} from '#test/index.js';
import {listRunAnnotationsRoute} from './list-run-annotations.js';
import {listRunJobExplanationsRoute} from './list-run-job-explanations.js';

const getProjectById = vi.fn();
const projects = {
  getProjectById,
  requireProjectForWorkspace: vi.fn(),
} as unknown as ProjectsModuleClient;
const listAnnotationsForRunAttempt = vi.fn();
const annotations = {
  replaceOrRemoveAnnotation: vi.fn(),
  listAnnotationsForRunAttempt,
} as unknown as AnnotationsInterModuleClient;

describe('workflow run annotation and job explanation routes', () => {
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
    app.get('/api/workflows/runs/:id/annotations', listRunAnnotationsRoute(annotations, projects));
    app.get('/api/workflows/runs/:id/job-explanations', listRunJobExplanationsRoute(projects));
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
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
    listAnnotationsForRunAttempt.mockReset();
  });

  test('reads annotation bodies through the owner and enriches the bounded page', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });
    workspaceId = fixture.run.workspaceId;
    const annotation = {
      id: crypto.randomUUID(),
      job_id: fixture.jobIds[0] as string,
      job_execution_id: fixture.executionIds[0] as string,
      origin_step_id: fixture.stepIds[0] as string,
      origin_step_attempt: 1,
      context: 'deployment-url',
      style: 'info' as const,
      sequence: 1,
      body: 'https://example.com/deployments/1',
    };
    listAnnotationsForRunAttempt.mockResolvedValue({
      annotations: [annotation],
      hasMore: true,
      nextCursor: {value: 1, id: annotation.id},
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${fixture.run.id}/annotations?attempt=1&limit=1`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(workflowRunAnnotationsResponseSchema.safeParse(body).success).toBe(true);
    expect(body.items[0]).toMatchObject({
      annotation,
      origin: {
        job_id: fixture.jobIds[0],
        job_label: 'measurement-job-0',
        job_position: 0,
        job_execution_id: fixture.executionIds[0],
        execution_sequence: 1,
        execution_label: 'measurement-execution-0-1',
        step_id: fixture.stepIds[0],
        step_label: 'Measurement step 0',
        step_attempt_id: fixture.stepAttemptIds[0],
        step_attempt: 1,
      },
    });
    expect(body.next_cursor).toEqual(expect.any(String));
    expect(listAnnotationsForRunAttempt).toHaveBeenCalledWith({
      workspaceId: fixture.run.workspaceId,
      workflowRunId: fixture.run.id,
      workflowRunAttempt: 1,
      limit: 1,
      cursor: undefined,
    });
  });

  test('exposes failed jobs that never created an execution', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });
    const jobId = fixture.jobIds[0] as string;
    workspaceId = fixture.run.workspaceId;
    await db()
      .delete(jobExecutions)
      .where(inArray(jobExecutions.jobId, [jobId]));
    await db()
      .update(jobs)
      .set({status: 'failed', statusReason: 'step_failed'})
      .where(inArray(jobs.id, [jobId]));

    const response = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${fixture.run.id}/job-explanations?attempt=1`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(workflowRunJobExplanationsResponseSchema.safeParse(body).success).toBe(true);
    expect(body.items).toEqual([
      {
        job_id: jobId,
        job_label: 'measurement-job-0',
        job_position: 0,
        status: 'failed',
        status_reason: 'step_failed',
        evaluation_trace: null,
      },
    ]);
  });

  test('rejects an annotation cursor without a UUID identifier', async () => {
    const cursor = Buffer.from(JSON.stringify({value: 1, id: 'not-a-uuid'})).toString('base64url');

    const response = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${crypto.randomUUID()}/annotations?attempt=1&cursor=${cursor}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({code: 'invalid-cursor'});
    expect(listAnnotationsForRunAttempt).not.toHaveBeenCalled();
  });
});
