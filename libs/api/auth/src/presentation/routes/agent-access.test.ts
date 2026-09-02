import {userAccessTokenKey} from '@shipfox/node-auth-root-key';
import {createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {eq} from 'drizzle-orm';
import {signUserToken} from '#core/jwt.js';
import {
  createAgentClient,
  createAgentGrant,
  createAgentRefreshToken,
  findActiveAgentRefreshTokenByHash,
  findAgentGrant,
} from '#db/agent-access.js';
import {db} from '#db/db.js';
import {agentGrants} from '#db/schema/agent-access.js';
import {createJwtAuthMethod} from '#presentation/auth/jwt-auth.js';
import {userFactory} from '#test/index.js';
import {createAgentAccessManagementRoutes} from './agent-access.js';

async function sessionToken(user: {id: string; email: string}) {
  return await signUserToken({
    userId: user.id,
    email: user.email,
    memberships: [],
    secret: userAccessTokenKey(),
    expiresIn: '15m',
  });
}

async function openApp(): Promise<FastifyInstance> {
  return await createApp({
    auth: [createJwtAuthMethod()],
    routes: [createAgentAccessManagementRoutes()],
    swagger: false,
  });
}

describe('agent access management routes', () => {
  test('lists only caller-owned OAuth grants and makes revocation idempotent', async () => {
    const owner = await userFactory.create();
    const other = await userFactory.create();
    const ownerWorkspaceId = crypto.randomUUID();
    const otherWorkspaceId = crypto.randomUUID();
    const ownerClient = await createAgentClient({
      clientId: `https://client.example/${crypto.randomUUID()}`,
      name: 'Owner client',
      redirectUris: ['https://client.example/callback'],
      kind: 'registered',
    });
    const otherClient = await createAgentClient({
      clientId: `https://client.example/${crypto.randomUUID()}`,
      name: 'Other client',
      redirectUris: ['https://client.example/callback'],
      kind: 'registered',
    });
    const ownerGrant = await createAgentGrant({
      userId: owner.id,
      workspaceId: ownerWorkspaceId,
      clientId: ownerClient.id,
      scopes: ['read'],
    });
    const otherGrant = await createAgentGrant({
      userId: other.id,
      workspaceId: otherWorkspaceId,
      clientId: otherClient.id,
      scopes: ['read'],
    });
    const refreshToken = await createAgentRefreshToken({
      grantId: ownerGrant.id,
      hashedToken: hashOpaqueToken(`refresh-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const app = await openApp();
    const token = await sessionToken(owner);

    try {
      const listed = await app.inject({
        method: 'GET',
        url: '/agent-access/grants',
        headers: {authorization: `Bearer ${token}`},
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toEqual({
        grants: [
          expect.objectContaining({
            id: ownerGrant.id,
            client_name: 'Owner client',
            workspace_id: ownerWorkspaceId,
            scopes: ['read'],
            last_refreshed_at: null,
          }),
        ],
      });

      const otherDelete = await app.inject({
        method: 'DELETE',
        url: `/agent-access/grants/${otherGrant.id}`,
        headers: {authorization: `Bearer ${token}`},
      });
      expect(otherDelete.statusCode).toBe(404);
      expect((await findAgentGrant({id: otherGrant.id}))?.revokedAt).toBeNull();

      const firstDelete = await app.inject({
        method: 'DELETE',
        url: `/agent-access/grants/${ownerGrant.id}`,
        headers: {authorization: `Bearer ${token}`},
      });
      const secondDelete = await app.inject({
        method: 'DELETE',
        url: `/agent-access/grants/${ownerGrant.id}`,
        headers: {authorization: `Bearer ${token}`},
      });
      expect(firstDelete.statusCode).toBe(204);
      expect(secondDelete.statusCode).toBe(204);
      expect(
        await findActiveAgentRefreshTokenByHash({hashedToken: refreshToken.hashedToken}),
      ).toBeUndefined();

      const relisted = await app.inject({
        method: 'GET',
        url: '/agent-access/grants',
        headers: {authorization: `Bearer ${token}`},
      });
      expect(relisted.statusCode).toBe(200);
      expect(relisted.json()).toEqual({grants: []});

      const terminalGrant = await createAgentGrant({
        userId: owner.id,
        workspaceId: crypto.randomUUID(),
        clientId: ownerClient.id,
        scopes: ['read'],
      });
      await db()
        .update(agentGrants)
        .set({terminalAt: new Date(), updatedAt: new Date()})
        .where(eq(agentGrants.id, terminalGrant.id));

      const terminalRelisted = await app.inject({
        method: 'GET',
        url: '/agent-access/grants',
        headers: {authorization: `Bearer ${token}`},
      });
      expect(terminalRelisted.statusCode).toBe(200);
      expect(terminalRelisted.json()).toEqual({grants: []});
    } finally {
      await app.close();
    }
  });
});
