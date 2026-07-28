import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {
  createRerunWorkflowRun,
  createWorkflowRun,
  updateWorkflowRunStatus,
} from '#db/workflow-runs.js';
import {workflowModel} from '#test/index.js';
import {listRunAttemptsRoute} from './list-run-attempts.js';

const projectAccessState = vi.hoisted(() => ({workspaceId: ''}));

const getProjectById = vi.fn();
const projects = {
  getProjectById,
  requireProjectForWorkspace: vi.fn(),
} as unknown as ProjectsModuleClient;

describe('GET /api/workflows/runs/:id/attempts', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectId: string;
  let definitionId: string;

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
    app.get('/api/workflows/runs/:id/attempts', listRunAttemptsRoute(projects));
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    definitionId = crypto.randomUUID();
    projectAccessState.workspaceId = workspaceId;
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

  test('returns attempts for the run', async () => {
    const {source, rerun} = await createLineage();

    const rootRes = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${source.id}/attempts`,
    });

    expect(rootRes.statusCode).toBe(200);
    expect(
      rootRes.json().attempts.map((attempt: {workflow_run_id: string}) => attempt.workflow_run_id),
    ).toEqual([source.id, source.id]);
    expect(rootRes.json().attempts[0]).toMatchObject({
      workflow_run_id: source.id,
      attempt: 1,
      status: 'failed',
      rerun_mode: null,
    });
    expect(rootRes.json().attempts[1]).toMatchObject({
      workflow_run_id: source.id,
      attempt: 2,
      status: 'pending',
      rerun_mode: 'all',
    });
    expect(rerun.id).toBe(source.id);
  });

  test('returns one attempt for a run without lineage', async () => {
    const run = await createRun();

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}/attempts`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().attempts).toHaveLength(1);
    expect(res.json().attempts[0]).toMatchObject({
      workflow_run_id: run.id,
      attempt: 1,
      rerun_mode: null,
    });
  });

  test('returns 404 for a missing or inaccessible run', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${crypto.randomUUID()}/attempts`,
    });
    const run = await createRun();
    getProjectById.mockRejectedValueOnce(new ClientError('Forbidden', 'forbidden', {status: 403}));

    const inaccessible = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}/attempts`,
    });

    expect(missing.statusCode).toBe(404);
    expect(inaccessible.statusCode).toBe(404);
  });

  async function createLineage() {
    const source = await createRun();
    await updateWorkflowRunStatus({workflowRunId: source.id, status: 'failed', expectedVersion: 1});
    const rerun = await createRerunWorkflowRun({
      workflowRunId: source.id,
      mode: 'all',
      actorUserId: crypto.randomUUID(),
    });

    return {source, rerun};
  }

  function createRun() {
    return createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: workflowModel({name: 'Deploy'}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
  }
});
