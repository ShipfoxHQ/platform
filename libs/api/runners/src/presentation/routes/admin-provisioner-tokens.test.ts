import {
  AUTH_LEASED_JOB,
  AUTH_PROVISIONER_TOKEN,
  AUTH_RUNNER_REGISTRATION_TOKEN,
  AUTH_RUNNER_SESSION,
  AUTH_USER,
  buildUserContext,
  setUserContext,
} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {vi} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {runnersAdminCommandResults} from '#db/schema/admin-command-results.js';
import {runnersOutbox} from '#db/schema/outbox.js';
import {provisionerTokens} from '#db/schema/provisioner-tokens.js';
import {provisionerTokenFactory, runnersTestAuthClient} from '#test/index.js';
import {createRunnerRoutes} from './index.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';

let authenticatedImpersonatorId: string | undefined;

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }
    setUserContext(
      request,
      buildUserContext({
        userId: USER_ID,
        email: 'admin@example.com',
        name: 'Administrator',
        memberships: [],
        impersonatorId: authenticatedImpersonatorId,
      }),
    );
    return Promise.resolve();
  },
};

const passthroughAuth = (name: string): AuthMethod => ({
  name,
  authenticate: () => Promise.resolve(),
});

describe('administrator installation provisioner tokens', () => {
  let app: FastifyInstance;
  let auth: AuthInterModuleClient;

  beforeEach(async () => {
    await closeApp();
    authenticatedImpersonatorId = undefined;
    auth = {
      ...runnersTestAuthClient,
      requireAdminRole: vi.fn().mockResolvedValue({role: 'admin-owner'}),
    };
    app = await createApp({
      auth: [
        fakeUserAuth,
        passthroughAuth(AUTH_RUNNER_REGISTRATION_TOKEN),
        passthroughAuth(AUTH_RUNNER_SESSION),
        passthroughAuth(AUTH_LEASED_JOB),
        passthroughAuth(AUTH_PROVISIONER_TOKEN),
      ],
      routes: createRunnerRoutes(auth),
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await db()
      .delete(runnersAdminCommandResults)
      .where(eq(runnersAdminCommandResults.actorId, USER_ID));
    await db().delete(provisionerTokens).where(eq(provisionerTokens.createdByUserId, USER_ID));
    await db()
      .delete(runnersOutbox)
      .where(eq(runnersOutbox.eventType, 'administration.action.performed'));
    await closeApp();
  });

  test('creates, lists, and revokes only installation metadata with idempotent retries', async () => {
    const createKey = `create-${crypto.randomUUID()}`;
    const createRequest = {
      method: 'POST' as const,
      url: '/admin/runners/provisioner-tokens',
      headers: {authorization: 'Bearer user', 'idempotency-key': createKey},
      payload: {name: 'Cloud managed runners', reason: 'Rotate the installation credential'},
    };
    const created = await app.inject(createRequest);
    expect(created.statusCode).toBe(201);
    const createdBody = created.json();
    expect(createdBody).toMatchObject({
      scope: 'installation',
      name: 'Cloud managed runners',
      status: 'active',
      raw_token: expect.any(String),
      correlation_id: expect.any(String),
    });

    const retry = await app.inject(createRequest);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toMatchObject({
      id: createdBody.id,
      raw_token: createdBody.raw_token,
      correlation_id: createdBody.correlation_id,
    });

    const rows = await db().select().from(runnersAdminCommandResults);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.result)).not.toContain(createdBody.raw_token);
    expect(JSON.stringify(rows[0]?.result)).not.toContain(hashOpaqueToken(createdBody.raw_token));

    const workspaceToken = await provisionerTokenFactory.create({
      workspaceId: crypto.randomUUID(),
      createdByUserId: USER_ID,
    });
    const list = await app.inject({
      method: 'GET',
      url: '/admin/runners/provisioner-tokens?status=active',
      headers: {authorization: 'Bearer user'},
    });
    expect(list.statusCode).toBe(200);
    const listedToken = list
      .json()
      .tokens.find((token: {id: string}) => token.id === createdBody.id);
    expect(listedToken).toMatchObject({id: createdBody.id, scope: 'installation'});
    expect(listedToken).not.toHaveProperty('raw_token');
    expect(listedToken).not.toHaveProperty('hashed_token');
    expect(list.json().tokens.map((token: {id: string}) => token.id)).not.toContain(
      workspaceToken.id,
    );

    vi.mocked(auth.requireAdminRole).mockResolvedValue({role: 'admin-operator'});
    const revokeKey = `revoke-${crypto.randomUUID()}`;
    const revokeRequest = {
      method: 'POST' as const,
      url: `/admin/runners/provisioner-tokens/${createdBody.id}/revoke`,
      headers: {authorization: 'Bearer user', 'idempotency-key': revokeKey},
      payload: {reason: 'Replace the installation credential'},
    };
    const revoked = await app.inject(revokeRequest);
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({id: createdBody.id, status: 'revoked'});
    expect(revoked.json()).not.toHaveProperty('raw_token');

    const revokeRetry = await app.inject(revokeRequest);
    expect(revokeRetry.statusCode).toBe(200);
    expect(revokeRetry.json()).toMatchObject({
      id: createdBody.id,
      correlation_id: revoked.json().correlation_id,
    });

    const noOpRevoke = await app.inject({
      ...revokeRequest,
      headers: {...revokeRequest.headers, 'idempotency-key': `revoke-no-op-${crypto.randomUUID()}`},
    });
    expect(noOpRevoke.statusCode).toBe(200);
    expect(noOpRevoke.json()).toMatchObject({
      id: createdBody.id,
      status: 'revoked',
      revoked_by_user_id: USER_ID,
    });

    const events = (await db().select().from(runnersOutbox)).filter(
      (event) => event.eventType === 'administration.action.performed',
    );
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.eventType)).toEqual([
      'administration.action.performed',
      'administration.action.performed',
    ]);
    expect(JSON.stringify(events)).not.toContain(createdBody.raw_token);
    expect(JSON.stringify(events)).not.toContain(hashOpaqueToken(createdBody.raw_token));
  });

  test('fails loudly when an idempotent create replay cannot reproduce its raw token', async () => {
    const createKey = `create-${crypto.randomUUID()}`;
    const createRequest = {
      method: 'POST' as const,
      url: '/admin/runners/provisioner-tokens',
      headers: {authorization: 'Bearer user', 'idempotency-key': createKey},
      payload: {reason: 'Create the installation credential'},
    };
    const created = await app.inject(createRequest);
    expect(created.statusCode).toBe(201);
    const createdBody = created.json();

    await db()
      .update(provisionerTokens)
      .set({hashedToken: hashOpaqueToken('a different token')})
      .where(eq(provisionerTokens.id, createdBody.id));

    const replay = await app.inject(createRequest);
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toMatchObject({code: 'idempotency-replay-unavailable'});
  });

  test('rejects an impersonated session before consulting the administrator role', async () => {
    authenticatedImpersonatorId = crypto.randomUUID();

    const response = await app.inject({
      method: 'POST',
      url: '/admin/runners/provisioner-tokens',
      headers: {authorization: 'Bearer user', 'idempotency-key': 'impersonated-create'},
      payload: {name: 'Cloud managed runners', reason: 'Impersonated attempt'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({code: 'admin-role-required'});
    expect(auth.requireAdminRole).not.toHaveBeenCalled();
  });

  test('rejects administrators without the required role', async () => {
    vi.mocked(auth.requireAdminRole).mockRejectedValueOnce(
      createInterModuleKnownError(
        authInterModuleContract.methods.requireAdminRole,
        'admin-role-required',
        {requiredRole: 'admin-owner'},
      ),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/admin/runners/provisioner-tokens',
      headers: {authorization: 'Bearer user', 'idempotency-key': 'owner-required'},
      payload: {reason: 'Create the installation credential'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 'forbidden',
      details: {required_role: 'admin-owner'},
    });
  });
});
