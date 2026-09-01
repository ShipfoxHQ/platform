import {AUTH_AGENT_ACCESS, getAgentAccessContext} from '@shipfox/api-auth-context';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {createApp, defineRoute, type FastifyInstance} from '@shipfox/node-fastify';
import {generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {vi} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import {issueAgentAccessToken} from '#core/agent-access-token.js';
import {
  createAgentPersonalAccessToken as createAgentPersonalAccessTokenInDb,
  revokeAgentPersonalAccessToken as revokeAgentPersonalAccessTokenInDb,
} from '#db/agent-access.js';
import {db} from '#db/db.js';
import {agentPersonalAccessTokens} from '#db/schema/agent-access.js';
import {users} from '#db/schema/users.js';
import {userFactory} from '#test/index.js';
import {createAgentAccessAuthMethod} from './agent-access-auth.js';

function workspaceClient(workspaceId: string, status: 'active' | 'suspended' = 'active') {
  return {
    listMembershipsForTokenClaims: vi.fn(async () => ({
      memberships: [{workspaceId, role: 'admin' as const, workspaceStatus: status}],
    })),
    requireActiveMembership: vi.fn(async () => ({})),
    getWorkspaceCreator: vi.fn(),
    getWorkspaceOperatingState: vi.fn(),
    preflightInvitationAcceptance: vi.fn(),
    acceptInvitation: vi.fn(),
  } as unknown as WorkspacesInterModuleClient;
}

const protectedRoute = defineRoute({
  method: 'GET',
  path: '/protected',
  description: 'Test agent access boundary.',
  auth: AUTH_AGENT_ACCESS,
  handler: (request) => getAgentAccessContext(request),
});

async function openApp(workspaces: WorkspacesInterModuleClient): Promise<FastifyInstance> {
  return await createApp({
    auth: [createAgentAccessAuthMethod(workspaces)],
    routes: [protectedRoute],
    swagger: false,
  });
}

describe('agent access auth method', () => {
  test('maps a stateless OAuth access token to the common context without a workspace lookup', async () => {
    const workspaceId = crypto.randomUUID();
    const workspaces = workspaceClient(workspaceId);
    const claims = {
      sub: crypto.randomUUID(),
      workspaceId,
      grantId: crypto.randomUUID(),
      clientId: 'client-id',
      scopes: ['read'] as Array<'read'>,
    };
    const token = await issueAgentAccessToken(claims);
    const app = await openApp(workspaces);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {authorization: `Bearer ${token}`},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        userId: claims.sub,
        workspaceId,
        scopes: ['read'],
        credential: {kind: 'oauth_grant', grantId: claims.grantId, clientId: claims.clientId},
      });
      expect(workspaces.listMembershipsForTokenClaims).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test('checks a PAT against its user and live workspace membership and records use', async () => {
    const user = await userFactory.create();
    const workspaceId = crypto.randomUUID();
    const workspaces = workspaceClient(workspaceId);
    const rawToken = generateOpaqueToken('personalAccessToken');
    const pat = await createAgentPersonalAccessTokenInDb({
      userId: user.id,
      workspaceId,
      hashedToken: hashOpaqueToken(rawToken),
      prefix: rawToken.slice(0, 12),
      name: 'Test PAT',
      scopes: ['read'],
      expiresAt: new Date(Date.now() + 60_000),
    });
    const app = await openApp(workspaces);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {authorization: `Bearer ${rawToken}`},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        userId: user.id,
        workspaceId,
        scopes: ['read'],
        credential: {kind: 'pat', patId: pat.id},
      });
      expect(workspaces.listMembershipsForTokenClaims).toHaveBeenCalledWith({userId: user.id});
      expect(workspaces.requireActiveMembership).toHaveBeenCalledWith({
        userId: user.id,
        workspaceId,
        memberships: [{workspaceId, role: 'admin', workspaceStatus: 'active'}],
      });
      const stored = await db()
        .select({lastUsedAt: agentPersonalAccessTokens.lastUsedAt})
        .from(agentPersonalAccessTokens)
        .where(eq(agentPersonalAccessTokens.id, pat.id));
      expect(stored).toHaveLength(1);
      expect(stored[0]?.lastUsedAt).toEqual(expect.any(Date));
    } finally {
      await app.close();
    }
  });

  test('rejects a PAT after revocation, user suspension, or workspace suspension', async () => {
    const user = await userFactory.create();
    const workspaceId = crypto.randomUUID();
    const workspaces = workspaceClient(workspaceId);
    const rawToken = generateOpaqueToken('personalAccessToken');
    const pat = await createAgentPersonalAccessTokenInDb({
      userId: user.id,
      workspaceId,
      hashedToken: hashOpaqueToken(rawToken),
      prefix: rawToken.slice(0, 12),
      name: 'Revocation PAT',
      scopes: ['read'],
      expiresAt: new Date(Date.now() + 60_000),
    });
    const app = await openApp(workspaces);

    try {
      await db().update(users).set({status: 'suspended'}).where(eq(users.id, user.id));
      const suspended = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {authorization: `Bearer ${rawToken}`},
      });
      expect(suspended.statusCode).toBe(401);

      await db().update(users).set({status: 'active'}).where(eq(users.id, user.id));
      workspaces.listMembershipsForTokenClaims = vi.fn(async () => ({
        memberships: [{workspaceId, role: 'admin' as const, workspaceStatus: 'suspended' as const}],
      })) as unknown as WorkspacesInterModuleClient['listMembershipsForTokenClaims'];
      const workspaceSuspended = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {authorization: `Bearer ${rawToken}`},
      });
      expect(workspaceSuspended.statusCode).toBe(401);

      await db().update(users).set({status: 'active'}).where(eq(users.id, user.id));
      await revokeAgentPersonalAccessTokenInDb({id: pat.id});
      workspaces.listMembershipsForTokenClaims = vi.fn(async () => ({
        memberships: [{workspaceId, role: 'admin' as const, workspaceStatus: 'active' as const}],
      })) as unknown as WorkspacesInterModuleClient['listMembershipsForTokenClaims'];
      const revoked = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {authorization: `Bearer ${rawToken}`},
      });
      expect(revoked.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
