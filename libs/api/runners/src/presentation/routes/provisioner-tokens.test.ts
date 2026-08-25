import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import type {AuthMethod} from '@shipfox/node-fastify';
import {ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {hashOpaqueToken, tokenTypeParts} from '@shipfox/node-tokens';
import {eq, sql} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {revokeProvisionerToken} from '#db/provisioner-tokens.js';
import {provisionerTokens} from '#db/schema/provisioner-tokens.js';
import {createProvisionerTokenAuthMethod} from '#presentation/auth/index.js';
import {provisionerTokenFactory} from '#test/index.js';
import {provisionerRoutes} from './index.js';
import {createListActiveProvisionersRoute} from './list-active-provisioners.js';

const userId = crypto.randomUUID();
let authenticatedMemberships: ReadonlyArray<UserContextMembership> = [];
let impersonatorId: string | undefined;

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }

    setUserContext(
      request,
      buildUserContext({
        userId,
        email: 'user@example.com',
        memberships: authenticatedMemberships,
        impersonatorId,
      }),
    );
    return Promise.resolve();
  },
};

describe('provisioner token routes', () => {
  let app: FastifyInstance;
  let workspaceId: string;

  beforeEach(async () => {
    await closeApp();
    workspaceId = crypto.randomUUID();
    authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
    impersonatorId = undefined;
    app = await createApp({
      auth: [fakeUserAuth, createProvisionerTokenAuthMethod()],
      routes: provisionerRoutes,
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
  });

  test('uses user auth for provisioner token management routes', () => {
    expect(provisionerRoutes[0]?.auth).toBe(AUTH_USER);
    expect(provisionerRoutes[1]?.auth).toBe(AUTH_USER);
  });

  describe('GET /workspaces/:workspaceId/provisioners/tokens', () => {
    it('returns 401 without user auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/provisioners/tokens`,
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when the user is not a workspace member', async () => {
      authenticatedMemberships = [
        {
          workspaceId: crypto.randomUUID(),
          role: 'admin',
          workspaceStatus: 'active',
        },
      ];

      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/provisioners/tokens`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('forbidden');
    });

    it('returns only usable tokens for the workspace', async () => {
      const usable = await provisionerTokenFactory.create({workspaceId, name: 'usable'});
      const expired = await provisionerTokenFactory.create({
        workspaceId,
        name: 'expired',
        expiresAt: new Date(Date.now() - 60_000),
      });
      const revoked = await provisionerTokenFactory.create({workspaceId, name: 'revoked'});
      await provisionerTokenFactory.create({
        workspaceId: crypto.randomUUID(),
        name: 'other workspace',
      });
      await revokeProvisionerToken({tokenId: revoked.id, workspaceId, revokedByUserId: userId});

      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/provisioners/tokens`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().tokens.map((token: {id: string}) => token.id)).toEqual([usable.id]);
      expect(res.json().tokens.map((token: {id: string}) => token.id)).not.toContain(expired.id);
    });
  });

  describe('GET /workspaces/:workspaceId/provisioners/active', () => {
    it('returns active provisioners for the workspace', async () => {
      const active = await provisionerTokenFactory.create({workspaceId, name: 'active'});
      await db().execute(
        sql`UPDATE runners_provisioner_tokens SET last_seen_at = now() WHERE id = ${active.id}`,
      );

      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/provisioners/active`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        provisioners: [
          expect.objectContaining({
            id: active.id,
            name: 'active',
            prefix: active.prefix,
            last_seen_at: expect.any(String),
          }),
        ],
        // The test environment configures RUNNER_RESERVED_LABELS, so the
        // installation always reports managed runner capacity.
        installation_runners: 'managed',
      });
    });

    it('reports managed installation runners from the reserved labels signal alone', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/provisioners/active`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().installation_runners).toBe('managed');
    });

    it('keeps active provisioners available when installation status is unavailable', async () => {
      await closeApp();
      app = await createApp({
        auth: [fakeUserAuth, createProvisionerTokenAuthMethod()],
        routes: [
          {
            prefix: '/workspaces/:workspaceId/provisioners/active',
            auth: AUTH_USER,
            routes: [
              createListActiveProvisionersRoute(() =>
                Promise.reject(new Error('status lookup unavailable')),
              ),
            ],
          },
        ],
        swagger: false,
      });
      await app.ready();

      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/provisioners/active`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({provisioners: [], installation_runners: 'none'});
    });
  });

  describe('POST /workspaces/:workspaceId/provisioners/tokens', () => {
    it('returns 401 without user auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspaceId}/provisioners/tokens`,
        payload: {name: 'scaler'},
      });

      expect(res.statusCode).toBe(401);
    });

    it('creates a workspace-scoped provisioner token and returns the raw token once', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspaceId}/provisioners/tokens`,
        headers: {authorization: 'Bearer user'},
        payload: {name: 'scaler', ttl_seconds: 3600},
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.raw_token.startsWith(`sf_${tokenTypeParts.provisionerToken}_`)).toBe(true);
      expect(body.prefix).toBe(body.raw_token.slice(0, 12));
      expect(body.name).toBe('scaler');
      expect(body.workspace_id).toBe(workspaceId);
      expect(body.created_by_user_id).toBe(userId);
      expect(body.expires_at).not.toBeNull();

      const rows = await db()
        .select()
        .from(provisionerTokens)
        .where(eq(provisionerTokens.id, body.id));
      expect(rows[0]?.hashedToken).toBe(hashOpaqueToken(body.raw_token));
      expect(rows[0]?.hashedToken).not.toBe(body.raw_token);
    });

    it('rejects an impersonated session with impersonation-not-permitted', async () => {
      impersonatorId = crypto.randomUUID();

      const res = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspaceId}/provisioners/tokens`,
        headers: {authorization: 'Bearer user'},
        payload: {name: 'scaler'},
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('impersonation-not-permitted');
    });

    it('rejects a token TTL above one year', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspaceId}/provisioners/tokens`,
        headers: {authorization: 'Bearer user'},
        payload: {ttl_seconds: 31_536_001},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /workspaces/:workspaceId/provisioners/tokens/:tokenId/revoke', () => {
    it('revokes a token owned by the authenticated workspace', async () => {
      const token = await provisionerTokenFactory.create({workspaceId});

      const res = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspaceId}/provisioners/tokens/${token.id}/revoke`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(token.id);
      expect(res.json().revoked_at).not.toBeNull();
      expect(res.json().revoked_by_user_id).toBe(userId);
    });

    it('returns 404 for a token owned by another workspace', async () => {
      const token = await provisionerTokenFactory.create({workspaceId: crypto.randomUUID()});

      const res = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspaceId}/provisioners/tokens/${token.id}/revoke`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('not-found');
    });
  });
});
