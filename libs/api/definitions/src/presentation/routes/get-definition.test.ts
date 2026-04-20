import {setApiKeyContext} from '@shipfox/api-auth-context';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {definitionFactory} from '#test/index.js';
import {getDefinitionRoute} from './get-definition.js';

vi.mock('@shipfox/api-projects', () => ({
  ProjectNotFoundError: class ProjectNotFoundError extends Error {},
  requireProjectForWorkspace: vi.fn(({projectId, workspaceId}) =>
    Promise.resolve({id: projectId, workspaceId}),
  ),
}));

describe('GET /api/definitions/:id', () => {
  let app: FastifyInstance;
  let workspaceId: string;

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
    app.get('/api/definitions/:id', getDefinitionRoute);
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
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

  test('returns 400 for invalid UUID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/definitions/not-a-uuid',
    });

    expect(res.statusCode).toBe(400);
  });
});
