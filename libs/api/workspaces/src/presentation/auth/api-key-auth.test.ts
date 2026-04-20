import {getApiKeyContext} from '@shipfox/api-auth-context';
import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {createApiKey, revokeApiKey} from '#db/api-keys.js';
import {createWorkspace, updateWorkspace} from '#db/workspaces.js';
import {createApiKeyAuthMethod} from './api-key-auth.js';

describe('api-key-auth', () => {
  let app: FastifyInstance;
  let workspaceId: string;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    const authMethod = createApiKeyAuthMethod();
    app.addHook('onRequest', async (request, reply) => {
      await authMethod.authenticate(request, reply);
    });

    app.get('/protected', (request) => {
      return {apiKeyContext: getApiKeyContext(request)};
    });
    await app.ready();
  });

  beforeEach(async () => {
    const workspace = await createWorkspace({name: `Auth Test ${crypto.randomUUID()}`});
    workspaceId = workspace.id;
  });

  test('valid API key sets apiKeyContext on request', async () => {
    const rawKey = generateOpaqueToken('apiKey');
    await createApiKey({
      workspaceId,
      hashedKey: hashOpaqueToken(rawKey),
      prefix: extractDisplayPrefix(rawKey),
      scopes: ['*'],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: `Bearer ${rawKey}`},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.apiKeyContext.workspaceId).toBe(workspaceId);
    expect(body.apiKeyContext.workspaceStatus).toBe('active');
    expect(body.apiKeyContext.scopes).toEqual(['*']);
  });

  test('missing Authorization header returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
  });

  test('malformed Bearer header returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: 'Bearer'},
    });

    expect(res.statusCode).toBe(401);
  });

  test('Basic auth scheme returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: 'Basic dXNlcjpwYXNz'},
    });

    expect(res.statusCode).toBe(401);
  });

  test('invalid key returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: 'Bearer sf_k_invalid_key_that_does_not_exist'},
    });

    expect(res.statusCode).toBe(401);
  });

  test('revoked key returns 401', async () => {
    const rawKey = generateOpaqueToken('apiKey');
    const apiKey = await createApiKey({
      workspaceId,
      hashedKey: hashOpaqueToken(rawKey),
      prefix: extractDisplayPrefix(rawKey),
      scopes: ['*'],
    });
    await revokeApiKey(apiKey.id);

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: `Bearer ${rawKey}`},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('api-key-revoked');
  });

  test('expired key returns 401', async () => {
    const rawKey = generateOpaqueToken('apiKey');
    await createApiKey({
      workspaceId,
      hashedKey: hashOpaqueToken(rawKey),
      prefix: extractDisplayPrefix(rawKey),
      scopes: ['*'],
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: `Bearer ${rawKey}`},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('api-key-expired');
  });

  test('inactive workspace returns 403', async () => {
    const rawKey = generateOpaqueToken('apiKey');
    await createApiKey({
      workspaceId,
      hashedKey: hashOpaqueToken(rawKey),
      prefix: extractDisplayPrefix(rawKey),
      scopes: ['*'],
    });
    await updateWorkspace({id: workspaceId, status: 'suspended'});

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: `Bearer ${rawKey}`},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('workspace-inactive');
  });
});
