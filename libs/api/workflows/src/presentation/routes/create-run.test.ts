import {setApiKeyContext} from '@shipfox/api-auth-context';
import type {WorkflowDefinition} from '@shipfox/api-definitions';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {createRunRoute} from './create-run.js';

vi.mock('@shipfox/api-definitions', () => ({
  getDefinitionById: vi.fn(),
}));

vi.mock('@shipfox/api-projects', () => ({
  ProjectNotFoundError: class ProjectNotFoundError extends Error {},
  requireProjectForWorkspace: vi.fn(({projectId, workspaceId}) =>
    Promise.resolve({id: projectId, workspaceId}),
  ),
}));

import {getDefinitionById} from '@shipfox/api-definitions';

const mockGetDefinitionById = vi.mocked(getDefinitionById);

function buildDefinition(projectId: string): WorkflowDefinition {
  return {
    id: crypto.randomUUID(),
    projectId,
    configPath: '.shipfox/workflows/test.yml',
    source: 'manual',
    sha: null,
    ref: null,
    name: 'Test Workflow',
    definition: {
      name: 'Test Workflow',
      jobs: {build: {steps: [{run: 'echo hello'}]}},
    },
    fetchedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('POST /api/workflows/runs', () => {
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
    app.post('/api/workflows/runs', createRunRoute);
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
  });

  test('valid request returns 201 with run DTO', async () => {
    const definition = buildDefinition(projectId);
    mockGetDefinitionById.mockResolvedValue(definition);

    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows/runs',
      payload: {project_id: projectId, definition_id: definition.id},
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.project_id).toBe(projectId);
    expect(body.definition_id).toBe(definition.id);
    expect(body.status).toBe('pending');
    expect(body.trigger_context).toEqual({type: 'manual'});
    expect(body.inputs).toBeNull();
    expect(body.created_at).toBeDefined();
    expect(body.updated_at).toBeDefined();
  });

  test('missing definition_id returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows/runs',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  test('non-existent definition returns 404', async () => {
    mockGetDefinitionById.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows/runs',
      payload: {project_id: projectId, definition_id: crypto.randomUUID()},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('definition-not-found');
  });

  test('invalid projectId UUID returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows/runs',
      payload: {project_id: 'not-a-uuid', definition_id: crypto.randomUUID()},
    });

    expect(res.statusCode).toBe(400);
  });

  test('project mismatch returns 403', async () => {
    const otherProjectId = crypto.randomUUID();
    const definition = buildDefinition(otherProjectId);
    mockGetDefinitionById.mockResolvedValue(definition);

    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows/runs',
      payload: {project_id: projectId, definition_id: definition.id},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('project-mismatch');
  });
});
