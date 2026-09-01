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
import {getRunLineageHeadRoute} from './get-run-lineage-head.js';

const getProjectById = vi.fn();
const projects = {
  getProjectById,
  requireProjectForWorkspace: vi.fn(),
} as unknown as ProjectsModuleClient;

describe('GET /api/workflows/runs/:id/head', () => {
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
    app.get('/api/workflows/runs/:id/head', getRunLineageHeadRoute(projects));
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    definitionId = crypto.randomUUID();
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

  test('returns the current and latest attempts without the run tree', async () => {
    const {source} = await createLineage();

    const response = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${source.id}/head`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      current_attempt: 2,
      latest_attempt: 2,
      current_status: 'pending',
      updated_at: expect.any(String),
    });
    expect(Object.keys(response.json())).toEqual([
      'current_attempt',
      'latest_attempt',
      'current_status',
      'updated_at',
    ]);
  });

  test('returns the stable not-found response for missing or inaccessible runs', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${crypto.randomUUID()}/head`,
    });
    const run = await createRun();
    getProjectById.mockRejectedValueOnce(new ClientError('Forbidden', 'forbidden', {status: 403}));

    const inaccessible = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}/head`,
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
