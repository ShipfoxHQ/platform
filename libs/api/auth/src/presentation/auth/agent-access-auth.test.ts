import {AUTH_AGENT_ACCESS, getAgentAccessContext} from '@shipfox/api-auth-context';
import {createApp, defineRoute, type FastifyInstance} from '@shipfox/node-fastify';
import {issueAgentAccessToken} from '#core/agent-access-token.js';
import {createAgentAccessAuthMethod} from './agent-access-auth.js';

const protectedRoute = defineRoute({
  method: 'GET',
  path: '/protected',
  description: 'Test agent access boundary.',
  auth: AUTH_AGENT_ACCESS,
  handler: (request) => getAgentAccessContext(request),
});

async function openApp(): Promise<FastifyInstance> {
  return await createApp({
    auth: [createAgentAccessAuthMethod()],
    routes: [protectedRoute],
    swagger: false,
  });
}

describe('agent access auth method', () => {
  test('maps a stateless OAuth access token to the common context', async () => {
    const claims = {
      sub: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      grantId: crypto.randomUUID(),
      clientId: 'client-id',
      scopes: ['read'] as Array<'read'>,
    };
    const token = await issueAgentAccessToken(claims);
    const app = await openApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {authorization: `Bearer ${token}`},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        userId: claims.sub,
        workspaceId: claims.workspaceId,
        scopes: ['read'],
        credential: {kind: 'oauth_grant', grantId: claims.grantId, clientId: claims.clientId},
      });
    } finally {
      await app.close();
    }
  });

  test('accepts an OAuth access token with a maximum-length client ID', async () => {
    const clientIdPrefix = 'https://client.example/';
    const clientId = clientIdPrefix + 'x'.repeat(2048 - clientIdPrefix.length);
    const token = await issueAgentAccessToken({
      sub: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      grantId: crypto.randomUUID(),
      clientId,
      scopes: ['read'],
    });
    expect(Buffer.byteLength(token, 'utf8')).toBeGreaterThan(1024);
    const app = await openApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {authorization: `Bearer ${token}`},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({credential: {kind: 'oauth_grant', clientId}});
    } finally {
      await app.close();
    }
  });

  test('rejects opaque and oversized credentials', async () => {
    const app = await openApp();

    try {
      for (const token of ['not-an-oauth-token', 'x'.repeat(8 * 1024 + 1)]) {
        const response = await app.inject({
          method: 'GET',
          url: '/protected',
          headers: {authorization: `Bearer ${token}`},
        });
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({code: 'unauthorized'});
      }
    } finally {
      await app.close();
    }
  });
});
