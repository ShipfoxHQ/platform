import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {softDeleteVcsDefinitionsNotIn} from '#db/index.js';
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

  test('returns 404 through the project-access gate for a lineage in another project', async () => {
    const definition = await definitionFactory.create({
      source: 'vcs',
      ref: 'main',
      configPath: '.shipfox/workflows/elsewhere.yml',
    });
    getProjectById.mockResolvedValueOnce({project: null});

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/${definition.workflowId}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('project-not-found');
  });

  test('returns 400 for invalid UUID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/definitions/not-a-uuid',
    });

    expect(res.statusCode).toBe(400);
  });
});
