import {setApiKeyContext} from '@shipfox/api-auth-context';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {definitionFactory} from '#test/index.js';
import {listDefinitionsRoute} from './list-definitions.js';

vi.mock('@shipfox/api-projects', () => ({
  ProjectNotFoundError: class ProjectNotFoundError extends Error {},
  requireProjectForWorkspace: vi.fn(({projectId, workspaceId}) =>
    Promise.resolve({id: projectId, workspaceId}),
  ),
}));

describe('GET /api/definitions', () => {
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
    app.get('/api/definitions', listDefinitionsRoute);
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
  });

  test('returns 200 with definitions list', async () => {
    await definitionFactory.create({projectId, name: 'Bravo', configPath: 'b.yml'});
    await definitionFactory.create({projectId, name: 'Alpha', configPath: 'a.yml'});

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions?project_id=${projectId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.definitions).toHaveLength(2);
    expect(body.definitions[0].name).toBe('Alpha');
    expect(body.definitions[1].name).toBe('Bravo');
  });

  test('returns 200 with empty array for project with no definitions', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions?project_id=${crypto.randomUUID()}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().definitions).toEqual([]);
  });

  test('invalid projectId UUID returns 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/definitions?project_id=not-a-uuid',
    });

    expect(res.statusCode).toBe(400);
  });
});
