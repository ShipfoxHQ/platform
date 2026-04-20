import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {createApiKey} from '#db/api-keys.js';
import {createWorkspace} from '#db/workspaces.js';
import {revokeApiKeyRoute} from './revoke.js';

describe('POST /workspaces/:workspaceId/api-keys/:apiKeyId/revoke', () => {
  let app: FastifyInstance;
  let workspaceId: string;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.post('/workspaces/:workspaceId/api-keys/:apiKeyId/revoke', revokeApiKeyRoute);
    await app.ready();
  });

  beforeEach(async () => {
    const workspace = await createWorkspace({name: `Revoke Test ${crypto.randomUUID()}`});
    workspaceId = workspace.id;
  });

  test('returns 200 with revokedAt set', async () => {
    const rawKey = generateOpaqueToken('apiKey');
    const apiKey = await createApiKey({
      workspaceId,
      hashedKey: hashOpaqueToken(rawKey),
      prefix: extractDisplayPrefix(rawKey),
      scopes: ['*'],
    });

    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/api-keys/${apiKey.id}/revoke`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().revoked_at).toBeDefined();
    expect(res.json().revoked_at).not.toBeNull();
  });

  test('non-existent key returns 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/api-keys/${crypto.randomUUID()}/revoke`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });
});
