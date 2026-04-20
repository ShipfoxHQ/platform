import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {createWorkspace} from '#db/workspaces.js';
import {createApiKeyRoute} from './create.js';

describe('POST /workspaces/:workspaceId/api-keys', () => {
  let app: FastifyInstance;
  let workspaceId: string;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.post('/workspaces/:workspaceId/api-keys', createApiKeyRoute);
    await app.ready();
  });

  beforeEach(async () => {
    const workspace = await createWorkspace({name: `API Key Test ${crypto.randomUUID()}`});
    workspaceId = workspace.id;
  });

  test('valid request returns 201 with raw_key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/api-keys`,
      payload: {scopes: ['read', 'write']},
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.raw_key).toBeDefined();
    expect(body.prefix).toBeDefined();
    expect(body.scopes).toEqual(['read', 'write']);
    expect(body.created_at).toBeDefined();
  });

  test('raw_key starts with sf_k_ prefix', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/api-keys`,
      payload: {scopes: ['*']},
    });

    const body = res.json();

    expect(body.raw_key.startsWith('sf_k_')).toBe(true);
  });

  test('prefix matches first 12 chars of raw_key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/api-keys`,
      payload: {scopes: ['*']},
    });

    const body = res.json();

    expect(body.prefix).toBe(body.raw_key.slice(0, 12));
  });

  test('non-existent workspace returns 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${crypto.randomUUID()}/api-keys`,
      payload: {scopes: ['*']},
    });

    expect(res.statusCode).toBe(404);
  });
});
