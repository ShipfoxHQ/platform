import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {createWorkspace} from '#db/workspaces.js';
import {getWorkspaceRoute} from './get.js';

describe('GET /workspaces/:workspaceId', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.get('/workspaces/:workspaceId', getWorkspaceRoute);
    await app.ready();
  });

  test('returns 200 with workspace when found', async () => {
    const workspace = await createWorkspace({name: 'Fetch Test'});

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspace.id}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(workspace.id);
    expect(res.json().name).toBe('Fetch Test');
  });

  test('returns 404 when not found', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${crypto.randomUUID()}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });
});
