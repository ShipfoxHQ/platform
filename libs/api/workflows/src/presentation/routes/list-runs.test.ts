import {setApiKeyContext} from '@shipfox/api-auth-context';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {createWorkflowRun} from '#db/workflow-runs.js';
import {listRunsRoute} from './list-runs.js';

vi.mock('@shipfox/api-projects', () => ({
  ProjectNotFoundError: class ProjectNotFoundError extends Error {},
  requireProjectForWorkspace: vi.fn(({projectId, workspaceId}) =>
    Promise.resolve({id: projectId, workspaceId}),
  ),
}));

describe('GET /api/workflows/runs', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectId: string;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.addHook('onRequest', (request, _reply, done) => {
      setApiKeyContext(request, {
        apiKeyId: crypto.randomUUID(),
        workspaceId,
        workspaceStatus: 'active',
        scopes: ['*'],
      });
      done();
    });
    app.get('/api/workflows/runs', listRunsRoute);
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
  });

  test('returns runs for a project', async () => {
    await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      definition: {name: 'Test', jobs: {build: {steps: [{run: 'echo'}]}}},
      triggerContext: {type: 'manual'},
    });
    await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      definition: {name: 'Test 2', jobs: {build: {steps: [{run: 'echo'}]}}},
      triggerContext: {type: 'manual'},
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs?project_id=${projectId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(2);
    expect(body.runs[0].project_id).toBe(projectId);
  });

  test('returns empty array for project with no runs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs?project_id=${projectId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runs).toEqual([]);
  });
});
