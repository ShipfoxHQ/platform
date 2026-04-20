import {AUTH_API_KEY, setApiKeyContext} from '@shipfox/api-auth-context';
import type {AuthMethod} from '@shipfox/node-fastify';
import {ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {hashOpaqueToken, tokenTypeParts} from '@shipfox/node-tokens';
import {eq, sql} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {runnerTokens} from '#db/schema/runner-tokens.js';
import {createRunnerTokenAuthMethod} from '#presentation/auth/index.js';
import {runnerTokenFactory} from '#test/index.js';
import {runnerRoutes} from './index.js';

function apiKeyAuthForWorkspace(workspaceId: string): AuthMethod {
  return {
    name: AUTH_API_KEY,
    authenticate: (request: FastifyRequest) => {
      if (request.headers.authorization !== `Bearer api:${workspaceId}`) {
        throw new ClientError('Invalid API key', 'unauthorized', {status: 401});
      }

      setApiKeyContext(request, {
        apiKeyId: crypto.randomUUID(),
        workspaceId,
        workspaceStatus: 'active',
        scopes: ['*'],
      });

      return Promise.resolve();
    },
  };
}

describe('runner token routes', () => {
  let app: FastifyInstance;
  let workspaceId: string;

  beforeEach(async () => {
    await closeApp();
    await db().execute(sql`TRUNCATE runners_runner_tokens CASCADE`);
    workspaceId = crypto.randomUUID();
    app = await createApp({
      auth: [apiKeyAuthForWorkspace(workspaceId), createRunnerTokenAuthMethod()],
      routes: runnerRoutes,
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
  });

  describe('POST /runners/tokens', () => {
    it('returns 401 without api-key auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/runners/tokens',
        payload: {name: 'builder'},
      });

      expect(res.statusCode).toBe(401);
    });

    it('creates a workspace-scoped runner token and returns the raw token once', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/runners/tokens',
        headers: {authorization: `Bearer api:${workspaceId}`},
        payload: {name: 'builder', ttl_seconds: 3600},
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.raw_token.startsWith(`sf_${tokenTypeParts.runnerToken}_`)).toBe(true);
      expect(body.prefix).toBe(body.raw_token.slice(0, 12));
      expect(body.name).toBe('builder');
      expect(body.workspace_id).toBe(workspaceId);
      expect(body.expires_at).not.toBeNull();

      const rows = await db().select().from(runnerTokens).where(eq(runnerTokens.id, body.id));
      expect(rows[0]?.hashedToken).toBe(hashOpaqueToken(body.raw_token));
      expect(rows[0]?.hashedToken).not.toBe(body.raw_token);
    });
  });

  describe('POST /runners/tokens/:tokenId/revoke', () => {
    it('revokes a token owned by the authenticated workspace', async () => {
      const token = await runnerTokenFactory.create({workspaceId});

      const res = await app.inject({
        method: 'POST',
        url: `/runners/tokens/${token.id}/revoke`,
        headers: {authorization: `Bearer api:${workspaceId}`},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(token.id);
      expect(res.json().revoked_at).not.toBeNull();
    });

    it('returns 404 for a token owned by another workspace', async () => {
      const token = await runnerTokenFactory.create({workspaceId: crypto.randomUUID()});

      const res = await app.inject({
        method: 'POST',
        url: `/runners/tokens/${token.id}/revoke`,
        headers: {authorization: `Bearer api:${workspaceId}`},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('not-found');
    });
  });
});
