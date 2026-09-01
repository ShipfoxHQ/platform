import {
  type WorkspacesInterModuleClient,
  workspacesInterModuleContract,
} from '@shipfox/api-workspaces-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {userAccessTokenKey} from '@shipfox/node-auth-root-key';
import {createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {generateOpaqueToken, hashOpaqueToken, tokenTypeParts} from '@shipfox/node-tokens';
import {vi} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import {signUserToken} from '#core/jwt.js';
import {
  createAgentClient,
  createAgentGrant,
  createAgentPersonalAccessToken,
  createAgentRefreshToken,
  findActiveAgentRefreshTokenByHash,
  findAgentGrant,
} from '#db/agent-access.js';
import {db} from '#db/db.js';
import {agentGrants} from '#db/schema/agent-access.js';
import {users} from '#db/schema/users.js';
import {createJwtAuthMethod} from '#presentation/auth/jwt-auth.js';
import {userFactory} from '#test/index.js';
import {createAgentAccessManagementRoutes} from './agent-access.js';

function workspacesFor(workspaceId: string, workspaceStatus: 'active' | 'suspended' = 'active') {
  return {
    listMembershipsForTokenClaims: vi.fn(async () => ({
      memberships: [{workspaceId, role: 'admin' as const, workspaceStatus}],
    })),
    requireActiveMembership: vi.fn(async () => ({})),
    getWorkspaceCreator: vi.fn(),
    getWorkspaceOperatingState: vi.fn(),
    preflightInvitationAcceptance: vi.fn(),
    acceptInvitation: vi.fn(),
  } as unknown as WorkspacesInterModuleClient;
}

async function sessionToken(user: {id: string; email: string}, impersonatorId?: string) {
  return await signUserToken({
    userId: user.id,
    email: user.email,
    memberships: [],
    ...(impersonatorId ? {impersonatorId} : {}),
    secret: userAccessTokenKey(),
    expiresIn: '15m',
  });
}

async function openApp(workspaces: WorkspacesInterModuleClient): Promise<FastifyInstance> {
  return await createApp({
    auth: [createJwtAuthMethod()],
    routes: [createAgentAccessManagementRoutes({workspaces})],
    swagger: false,
  });
}

describe('agent access management routes', () => {
  test('lists only caller-owned grants and makes revocation idempotent', async () => {
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
    const workspaces = workspacesFor(ownerWorkspaceId);
    const app = await openApp(workspaces);
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

  test('mints a one-time raw PAT, lists metadata, and protects ownership and expiry rules', async () => {
    const owner = await userFactory.create();
    const other = await userFactory.create();
    const workspaceId = crypto.randomUUID();
    const otherWorkspaceId = crypto.randomUUID();
    const workspaces = workspacesFor(workspaceId);
    const app = await openApp(workspaces);
    const token = await sessionToken(owner);

    try {
      const created = await app.inject({
        method: 'POST',
        url: '/agent-access/pats',
        headers: {authorization: `Bearer ${token}`},
        payload: {workspace_id: workspaceId, name: 'CI access', expires_in_days: 30},
      });

      expect(created.statusCode).toBe(201);
      const body = created.json();
      expect(body.raw_token).toEqual(
        expect.stringContaining(`sf_${tokenTypeParts.personalAccessToken}_`),
      );
      expect(body.prefix).toBe(body.raw_token.slice(0, 12));
      expect(body.name).toBe('CI access');
      expect(body.workspace_id).toBe(workspaceId);
      expect(body.last_used_at).toBeNull();
      const dayInMilliseconds = 24 * 60 * 60 * 1000;
      const firstExpiryDelta = Date.parse(body.expires_at) - Date.parse(body.created_at);
      expect(firstExpiryDelta).toBeGreaterThan(30 * dayInMilliseconds - 60_000);
      expect(firstExpiryDelta).toBeLessThan(30 * dayInMilliseconds + 60_000);

      const listed = await app.inject({
        method: 'GET',
        url: '/agent-access/pats',
        headers: {authorization: `Bearer ${token}`},
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toEqual({
        pats: [
          expect.objectContaining({
            id: body.id,
            workspace_id: workspaceId,
            prefix: body.prefix,
            name: 'CI access',
            last_used_at: null,
          }),
        ],
      });
      expect(JSON.stringify(listed.json())).not.toContain(body.raw_token);

      const defaultExpiry = await app.inject({
        method: 'POST',
        url: '/agent-access/pats',
        headers: {authorization: `Bearer ${token}`},
        payload: {workspace_id: workspaceId, name: 'Default expiry access'},
      });
      expect(defaultExpiry.statusCode).toBe(201);
      const defaultExpiryBody = defaultExpiry.json();
      const defaultExpiryDelta =
        Date.parse(defaultExpiryBody.expires_at) - Date.parse(defaultExpiryBody.created_at);
      expect(defaultExpiryDelta).toBeGreaterThan(90 * dayInMilliseconds - 60_000);
      expect(defaultExpiryDelta).toBeLessThan(90 * dayInMilliseconds + 60_000);

      const invalidExpiry = await app.inject({
        method: 'POST',
        url: '/agent-access/pats',
        headers: {authorization: `Bearer ${token}`},
        payload: {workspace_id: workspaceId, name: 'Invalid', expires_in_days: 7},
      });
      expect(invalidExpiry.statusCode).toBe(400);

      const otherPatToken = generateOpaqueToken('personalAccessToken');
      const otherPat = await createAgentPersonalAccessToken({
        userId: other.id,
        workspaceId: otherWorkspaceId,
        hashedToken: hashOpaqueToken(otherPatToken),
        prefix: otherPatToken.slice(0, 12),
        name: 'Other PAT',
        scopes: ['read'],
        expiresAt: new Date(Date.now() + 60_000),
      });
      const otherDelete = await app.inject({
        method: 'DELETE',
        url: `/agent-access/pats/${otherPat.id}`,
        headers: {authorization: `Bearer ${token}`},
      });
      expect(otherDelete.statusCode).toBe(404);

      const firstDelete = await app.inject({
        method: 'DELETE',
        url: `/agent-access/pats/${body.id}`,
        headers: {authorization: `Bearer ${token}`},
      });
      const secondDelete = await app.inject({
        method: 'DELETE',
        url: `/agent-access/pats/${body.id}`,
        headers: {authorization: `Bearer ${token}`},
      });
      expect(firstDelete.statusCode).toBe(204);
      expect(secondDelete.statusCode).toBe(204);

      const defaultDelete = await app.inject({
        method: 'DELETE',
        url: `/agent-access/pats/${defaultExpiryBody.id}`,
        headers: {authorization: `Bearer ${token}`},
      });
      expect(defaultDelete.statusCode).toBe(204);

      const relisted = await app.inject({
        method: 'GET',
        url: '/agent-access/pats',
        headers: {authorization: `Bearer ${token}`},
      });
      expect(relisted.statusCode).toBe(200);
      expect(relisted.json()).toEqual({pats: []});

      await db().update(users).set({status: 'suspended'}).where(eq(users.id, owner.id));
      const suspendedMint = await app.inject({
        method: 'POST',
        url: '/agent-access/pats',
        headers: {authorization: `Bearer ${token}`},
        payload: {workspace_id: workspaceId, name: 'Suspended', expires_in_days: 90},
      });
      expect(suspendedMint.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  test('translates workspace membership failures and dependency outages', async () => {
    const owner = await userFactory.create();
    const workspaceId = crypto.randomUUID();
    const token = await sessionToken(owner);
    const method = workspacesInterModuleContract.methods.requireActiveMembership;
    const knownFailures = [
      ['membership-required', 'forbidden'],
      ['workspace-not-found', 'workspace-inactive'],
      ['workspace-inactive', 'workspace-inactive'],
    ] as const;

    for (const [failureCode, responseCode] of knownFailures) {
      const workspaces = workspacesFor(workspaceId);
      workspaces.requireActiveMembership = vi.fn(() => {
        throw createInterModuleKnownError(method, failureCode, {workspaceId});
      }) as unknown as WorkspacesInterModuleClient['requireActiveMembership'];
      const app = await openApp(workspaces);

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/agent-access/pats',
          headers: {authorization: `Bearer ${token}`},
          payload: {workspace_id: workspaceId, name: `Failure ${failureCode}`},
        });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({code: responseCode});
      } finally {
        await app.close();
      }
    }

    const suspendedWorkspaces = workspacesFor(workspaceId, 'suspended');
    const suspendedApp = await openApp(suspendedWorkspaces);
    try {
      const response = await suspendedApp.inject({
        method: 'POST',
        url: '/agent-access/pats',
        headers: {authorization: `Bearer ${token}`},
        payload: {workspace_id: workspaceId, name: 'Suspended workspace'},
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({code: 'workspace-suspended'});
    } finally {
      await suspendedApp.close();
    }

    const unavailableWorkspaces = workspacesFor(workspaceId);
    unavailableWorkspaces.requireActiveMembership = vi.fn(() => {
      throw new Error('workspaces unavailable');
    }) as unknown as WorkspacesInterModuleClient['requireActiveMembership'];
    const unavailableApp = await openApp(unavailableWorkspaces);
    try {
      const response = await unavailableApp.inject({
        method: 'POST',
        url: '/agent-access/pats',
        headers: {authorization: `Bearer ${token}`},
        payload: {workspace_id: workspaceId, name: 'Unavailable workspace'},
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({code: 'auth-dependency-unavailable'});
    } finally {
      await unavailableApp.close();
    }
  });

  test('returns a controlled server error for invalid persisted grant scopes', async () => {
    const owner = await userFactory.create();
    const client = await createAgentClient({
      clientId: `https://client.example/${crypto.randomUUID()}`,
      name: 'Invalid scope client',
      redirectUris: ['https://client.example/callback'],
      kind: 'registered',
    });
    await createAgentGrant({
      userId: owner.id,
      workspaceId: crypto.randomUUID(),
      clientId: client.id,
      scopes: ['write'],
    });
    const workspaces = workspacesFor(crypto.randomUUID());
    const app = await openApp(workspaces);
    const token = await sessionToken(owner);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/agent-access/grants',
        headers: {authorization: `Bearer ${token}`},
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({code: 'server-error'});
    } finally {
      await app.close();
    }
  });

  test('does not let an impersonated session mint a PAT', async () => {
    const owner = await userFactory.create();
    const workspaceId = crypto.randomUUID();
    const workspaces = workspacesFor(workspaceId);
    const app = await openApp(workspaces);
    const token = await sessionToken(owner, crypto.randomUUID());

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/agent-access/pats',
        headers: {authorization: `Bearer ${token}`},
        payload: {workspace_id: workspaceId, name: 'Impersonated', expires_in_days: 90},
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('impersonation-not-permitted');
    } finally {
      await app.close();
    }
  });
});
