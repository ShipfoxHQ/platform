import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {softDeleteVcsDefinitionsNotIn} from '#db/definitions.js';
import {definitionFactory} from '#test/index.js';
import {buildGetDefinitionRoute} from './get-definition.js';

const projectAccessState = vi.hoisted(() => ({workspaceId: ''}));

const getProjectById = vi.fn<ProjectsModuleClient['getProjectById']>(({projectId}) =>
  Promise.resolve({
    project: {
      id: projectId,
      workspaceId: projectAccessState.workspaceId,
      sourceConnectionId: crypto.randomUUID(),
      sourceExternalRepositoryId: 'repo',
      sourceDefaultBranch: 'main',
      name: 'Project',
    },
  }),
);

const projects = {
  getProjectById,
  requireProjectForWorkspace: vi.fn(),
} as unknown as ProjectsModuleClient;

describe('GET /api/definitions/:id', () => {
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
    app.get('/api/definitions/:id', buildGetDefinitionRoute(projects));
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectAccessState.workspaceId = workspaceId;
  });

  test('returns 200 with definition when found', async () => {
    const definition = await definitionFactory.create();

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/${definition.id}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(definition.id);
    expect(res.json().name).toBe(definition.name);
  });

  test('returns 404 when not found', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/${crypto.randomUUID()}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  test('returns 200 with the synced row when the id is a lineage id with a synced row', async () => {
    const definition = await definitionFactory.create({
      source: 'vcs',
      ref: 'main',
      configPath: '.shipfox/workflows/lineage.yml',
    });
    expect(definition.workflowId).not.toBe(definition.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/${definition.workflowId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(definition.id);
    expect(res.json().ref).toBe('main');
  });

  test('returns 404 when the id is a lineage id without a synced row', async () => {
    const definition = await definitionFactory.create({
      source: 'vcs',
      ref: 'main',
      configPath: '.shipfox/workflows/removed.yml',
    });
    await softDeleteVcsDefinitionsNotIn({
      projectId: definition.projectId,
      workspaceId,
      ref: 'main',
      keepConfigPaths: [],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/${definition.workflowId}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  test('returns 404 when a lineage only has a non-default branch row', async () => {
    const definition = await definitionFactory.create({
      source: 'vcs',
      ref: 'feature/lineage',
      configPath: '.shipfox/workflows/non-default.yml',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/${definition.workflowId}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  test('returns the row from the project default branch when a lineage has multiple refs', async () => {
    const projectId = crypto.randomUUID();
    const main = await definitionFactory.create({
      projectId,
      source: 'vcs',
      ref: 'main',
      configPath: '.shipfox/workflows/multi-ref.yml',
      name: 'Main Workflow',
    });
    await definitionFactory.create({
      projectId,
      source: 'vcs',
      ref: 'feature/lineage',
      configPath: '.shipfox/workflows/multi-ref.yml',
      name: 'Feature Workflow',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/${main.workflowId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(main.id);
    expect(res.json().name).toBe('Main Workflow');
    expect(res.json().ref).toBe('main');
  });

  test('returns 403 through the project-access gate for a lineage in another workspace', async () => {
    const definition = await definitionFactory.create({
      source: 'vcs',
      ref: 'main',
      configPath: '.shipfox/workflows/elsewhere.yml',
    });
    getProjectById.mockResolvedValueOnce({
      project: {
        id: definition.projectId,
        workspaceId: crypto.randomUUID(),
        sourceConnectionId: crypto.randomUUID(),
        sourceExternalRepositoryId: 'repo',
        sourceDefaultBranch: 'main',
        name: 'Project',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/${definition.workflowId}`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });

  test('returns 400 for invalid UUID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/definitions/not-a-uuid',
    });

    expect(res.statusCode).toBe(400);
  });
});
