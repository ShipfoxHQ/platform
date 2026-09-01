import {createHash, randomBytes} from 'node:crypto';
import {
  type WorkspacesInterModuleClient,
  workspacesInterModuleContract,
} from '@shipfox/api-workspaces-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {describe, expect, it, vi} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import {verifyAgentAccessToken} from '#core/agent-access-token.js';
import {signUserToken} from '#core/jwt.js';
import {createOAuthClientResolver} from '#core/oauth-client-resolver.js';
import {createAgentClient, findAgentClientByClientId} from '#db/agent-access.js';
import {db} from '#db/db.js';
import {users} from '#db/schema/users.js';
import {createJwtAuthMethod} from '#presentation/auth/jwt-auth.js';
import {createVerifiedSession, ROUTE_TEST_SECRET} from '#test/routes.js';
import {createOAuthAuthorizationRoutes} from './oauth.js';

const API_ORIGIN = 'https://api.example.test';
const RESOURCE = `${API_ORIGIN}/mcp`;
const REDIRECT_URI = 'https://client.example/callback';
const UUID_PATTERN = /^[0-9a-f-]{36}$/u;

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return {verifier, challenge};
}

function workspaceClient(workspaceId: string) {
  const memberships = [{workspaceId, role: 'admin' as const, workspaceStatus: 'active' as const}];
  return {
    listMembershipsForTokenClaims: vi.fn(async () => ({memberships})),
    requireActiveMembership: vi.fn(async () => ({})),
  } as unknown as WorkspacesInterModuleClient;
}

async function createTestClient() {
  return await createAgentClient({
    clientId: `client_${crypto.randomUUID()}`,
    name: 'Desktop agent',
    redirectUris: [REDIRECT_URI],
    kind: 'registered',
  });
}

async function createTestApp(workspaces: WorkspacesInterModuleClient): Promise<FastifyInstance> {
  const resolver = createOAuthClientResolver({
    findClient: async ({clientId}) => await findAgentClientByClientId({clientId}),
  });
  return await createApp({
    auth: [createJwtAuthMethod()],
    routes: [
      createOAuthAuthorizationRoutes({
        apiPublicUrl: `${API_ORIGIN}/`,
        clientBaseUrl: 'https://app.example.test',
        clientResolver: resolver,
        workspaces,
      }),
    ],
    swagger: false,
  });
}

function authorizationUrl(clientId: string, challenge: string, state = 'client-state'): string {
  const url = new URL('/oauth/authorize', API_ORIGIN);
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: RESOURCE,
    scope: 'read',
    state,
  }).toString();
  return url.pathname + url.search;
}

function bearer(token: string) {
  return {authorization: `Bearer ${token}`};
}

describe('dormant OAuth authorization and token routes', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it('keeps validated parameters server-side through approval and exchanges a PKCE code', async () => {
    const workspaceId = crypto.randomUUID();
    const workspaces = workspaceClient(workspaceId);
    const account = await createVerifiedSession('oauth-flow');
    const client = await createTestClient();
    app = await createTestApp(workspaces);
    const {verifier, challenge} = pkce();

    const authorization = await app.inject({
      method: 'GET',
      url: authorizationUrl(client.clientId, challenge),
      headers: {'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200) + 1}`},
    });
    expect(authorization.statusCode).toBe(302);
    const consentLocation = authorization.headers.location;
    expect(consentLocation).toBeDefined();
    const consentUrl = new URL(consentLocation ?? 'https://invalid.example');
    const requestId = consentUrl.searchParams.get('request_id');
    expect(requestId).toMatch(UUID_PATTERN);
    expect([...consentUrl.searchParams.keys()]).toEqual(['request_id']);

    const detail = await app.inject({
      method: 'GET',
      url: `/oauth/consents/${requestId}`,
      headers: bearer(account.token),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      request_id: requestId,
      client_name: 'Desktop agent',
      scope: 'read',
      redirect_uri_hostname: 'client.example',
      client_identity_origin: 'registered client',
      is_loopback_redirect: false,
      workspaces: [{workspace_id: workspaceId, role: 'admin'}],
    });

    const approval = await app.inject({
      method: 'POST',
      url: `/oauth/consents/${requestId}/approve`,
      headers: bearer(account.token),
      payload: {workspace_id: workspaceId},
    });
    expect(approval.statusCode).toBe(200);
    const callback = new URL(approval.json().redirect_url);
    expect(callback.searchParams.get('state')).toBe('client-state');
    const code = callback.searchParams.get('code');
    expect(code).toBeTruthy();

    const token = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': '198.51.100.240',
      },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: client.clientId,
        code: code ?? '',
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
        resource: RESOURCE,
      }).toString(),
    });
    expect(token.statusCode).toBe(200);
    expect(token.json()).toMatchObject({
      token_type: 'Bearer',
      expires_in: 900,
      scope: 'read',
      access_token: expect.any(String),
      refresh_token: expect.any(String),
    });

    const accessClaims = await verifyAgentAccessToken(token.json().access_token);
    expect(accessClaims).toMatchObject({
      sub: account.userId,
      workspaceId,
      clientId: client.clientId,
      scopes: ['read'],
    });

    const replay = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {'x-forwarded-for': '198.51.100.246'},
      payload: {
        grant_type: 'authorization_code',
        client_id: client.clientId,
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      },
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json()).toMatchObject({error: 'invalid_grant'});
  });

  it('returns denial through the stored redirect and makes the request single-use', async () => {
    const workspaces = workspaceClient(crypto.randomUUID());
    const account = await createVerifiedSession('oauth-deny');
    const client = await createTestClient();
    app = await createTestApp(workspaces);
    const {challenge} = pkce();
    const authorization = await app.inject({
      method: 'GET',
      url: authorizationUrl(client.clientId, challenge, 'deny-state'),
      headers: {'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200) + 1}`},
    });
    const requestId = new URL(authorization.headers.location ?? '').searchParams.get('request_id');
    expect(requestId).toBeTruthy();

    const denial = await app.inject({
      method: 'POST',
      url: `/oauth/consents/${requestId}/deny`,
      headers: bearer(account.token),
    });
    expect(denial.statusCode).toBe(200);
    const callback = new URL(denial.json().redirect_url);
    expect(callback.searchParams.get('error')).toBe('access_denied');
    expect(callback.searchParams.get('state')).toBe('deny-state');

    const replay = await app.inject({
      method: 'POST',
      url: `/oauth/consents/${requestId}/deny`,
      headers: bearer(account.token),
    });
    expect(replay.statusCode).toBe(404);
    expect(replay.json()).toEqual({code: 'not-found'});
  });

  it('serializes refresh rotation, allows a grace replay, and rejects a bad PKCE exchange', async () => {
    const workspaceId = crypto.randomUUID();
    const workspaces = workspaceClient(workspaceId);
    const account = await createVerifiedSession('oauth-refresh');
    const client = await createTestClient();
    app = await createTestApp(workspaces);
    const firstPkce = pkce();
    const authorization = await app.inject({
      method: 'GET',
      url: authorizationUrl(client.clientId, firstPkce.challenge),
      headers: {'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200) + 1}`},
    });
    const requestId = new URL(authorization.headers.location ?? '').searchParams.get('request_id');
    const approval = await app.inject({
      method: 'POST',
      url: `/oauth/consents/${requestId}/approve`,
      headers: bearer(account.token),
      payload: {workspace_id: workspaceId},
    });
    const code = new URL(approval.json().redirect_url).searchParams.get('code') ?? '';

    const badCode = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {'x-forwarded-for': '198.51.100.241'},
      payload: {
        grant_type: 'authorization_code',
        client_id: client.clientId,
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: 'a'.repeat(43),
      },
    });
    expect(badCode.statusCode).toBe(400);
    expect(badCode.json()).toMatchObject({error: 'invalid_grant'});

    const token = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {'x-forwarded-for': '198.51.100.242'},
      payload: {
        grant_type: 'authorization_code',
        client_id: client.clientId,
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: firstPkce.verifier,
      },
    });
    const refreshToken = token.json().refresh_token;
    expect(token.statusCode).toBe(200);
    expect(refreshToken).toEqual(expect.any(String));

    const refresh = () =>
      app.inject({
        method: 'POST',
        url: '/oauth/token',
        headers: {'x-forwarded-for': '198.51.100.243'},
        payload: {
          grant_type: 'refresh_token',
          client_id: client.clientId,
          refresh_token: refreshToken,
        },
      });
    const [first, second] = await Promise.all([refresh(), refresh()]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().access_token).toEqual(expect.any(String));
    expect(second.json().access_token).toEqual(expect.any(String));
    expect([first.json().refresh_token, second.json().refresh_token].filter(Boolean)).toHaveLength(
      1,
    );
  });

  it('rejects impersonated approval and preserves 404-shaped workspace ownership failures', async () => {
    const workspaceId = crypto.randomUUID();
    const account = await createVerifiedSession('oauth-impersonation');
    const client = await createTestClient();
    const workspaces = workspaceClient(workspaceId);
    workspaces.requireActiveMembership = vi.fn(() => {
      throw createInterModuleKnownError(
        workspacesInterModuleContract.methods.requireActiveMembership,
        'membership-required',
        {workspaceId},
      );
    }) as unknown as WorkspacesInterModuleClient['requireActiveMembership'];
    app = await createTestApp(workspaces);
    const {challenge} = pkce();
    const authorization = await app.inject({
      method: 'GET',
      url: authorizationUrl(client.clientId, challenge),
      headers: {'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200) + 1}`},
    });
    const requestId = new URL(authorization.headers.location ?? '').searchParams.get('request_id');
    const impersonated = await signUserToken({
      userId: account.userId,
      email: account.email,
      name: 'Impersonated User',
      memberships: [],
      impersonatorId: crypto.randomUUID(),
      secret: ROUTE_TEST_SECRET,
      expiresIn: '15m',
    });

    const rejected = await app.inject({
      method: 'POST',
      url: `/oauth/consents/${requestId}/approve`,
      headers: bearer(impersonated),
      payload: {workspace_id: workspaceId},
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toEqual({code: 'impersonation-not-permitted'});

    const ownership = await app.inject({
      method: 'POST',
      url: `/oauth/consents/${requestId}/approve`,
      headers: bearer(account.token),
      payload: {workspace_id: workspaceId},
    });
    expect(ownership.statusCode).toBe(404);
    expect(ownership.json()).toEqual({code: 'not-found'});
  });

  it('uses standard authorization errors without redirecting an untrusted client', async () => {
    const workspaces = workspaceClient(crypto.randomUUID());
    const client = await createTestClient();
    app = await createTestApp(workspaces);
    const {challenge} = pkce();

    const invalidTarget = await app.inject({
      method: 'GET',
      url: authorizationUrl(client.clientId, challenge).replace(
        encodeURIComponent(RESOURCE),
        encodeURIComponent(`${API_ORIGIN}/other`),
      ),
      headers: {'x-forwarded-for': '198.51.100.247'},
    });
    expect(invalidTarget.statusCode).toBe(302);
    const targetCallback = new URL(invalidTarget.headers.location ?? '');
    expect(targetCallback.searchParams.get('error')).toBe('invalid_target');
    expect(targetCallback.searchParams.get('state')).toBe('client-state');

    const invalidScope = await app.inject({
      method: 'GET',
      url: authorizationUrl(client.clientId, challenge).replace('scope=read', 'scope=write'),
      headers: {'x-forwarded-for': '198.51.100.248'},
    });
    expect(invalidScope.statusCode).toBe(302);
    const scopeCallback = new URL(invalidScope.headers.location ?? '');
    expect(scopeCallback.searchParams.get('error')).toBe('invalid_scope');
    expect(scopeCallback.searchParams.get('state')).toBe('client-state');

    const invalidRedirect = await app.inject({
      method: 'GET',
      url: authorizationUrl(client.clientId, challenge).replace(
        encodeURIComponent(REDIRECT_URI),
        encodeURIComponent('https://other.example/callback'),
      ),
      headers: {'x-forwarded-for': '198.51.100.249'},
    });
    expect(invalidRedirect.statusCode).toBe(400);
    expect(invalidRedirect.json()).toMatchObject({error: 'invalid_request'});
  });

  it('rejects approval after the account is suspended and treats malformed ids as not found', async () => {
    const workspaceId = crypto.randomUUID();
    const workspaces = workspaceClient(workspaceId);
    const account = await createVerifiedSession('oauth-suspended-approval');
    const client = await createTestClient();
    app = await createTestApp(workspaces);
    const {challenge} = pkce();
    const authorization = await app.inject({
      method: 'GET',
      url: authorizationUrl(client.clientId, challenge),
      headers: {'x-forwarded-for': '198.51.100.250'},
    });
    const requestId = new URL(authorization.headers.location ?? '').searchParams.get('request_id');

    await db().update(users).set({status: 'suspended'}).where(eq(users.id, account.userId));
    const rejected = await app.inject({
      method: 'POST',
      url: `/oauth/consents/${requestId}/approve`,
      headers: bearer(account.token),
      payload: {workspace_id: workspaceId},
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toEqual({code: 'access-denied'});

    const malformed = await app.inject({
      method: 'GET',
      url: '/oauth/consents/not-a-uuid',
      headers: bearer(account.token),
    });
    expect(malformed.statusCode).toBe(404);
    expect(malformed.json()).toEqual({code: 'not-found'});
  });

  it('rejects an OAuth code when the user is suspended after approval', async () => {
    const workspaceId = crypto.randomUUID();
    const workspaces = workspaceClient(workspaceId);
    const account = await createVerifiedSession('oauth-suspended');
    const client = await createTestClient();
    app = await createTestApp(workspaces);
    const {verifier, challenge} = pkce();
    const authorization = await app.inject({
      method: 'GET',
      url: authorizationUrl(client.clientId, challenge),
      headers: {'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200) + 1}`},
    });
    const requestId = new URL(authorization.headers.location ?? '').searchParams.get('request_id');
    const approval = await app.inject({
      method: 'POST',
      url: `/oauth/consents/${requestId}/approve`,
      headers: bearer(account.token),
      payload: {workspace_id: workspaceId},
    });
    const code = new URL(approval.json().redirect_url).searchParams.get('code') ?? '';
    await db().update(users).set({status: 'suspended'}).where(eq(users.id, account.userId));

    const token = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {'x-forwarded-for': '198.51.100.245'},
      payload: {
        grant_type: 'authorization_code',
        client_id: client.clientId,
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      },
    });
    expect(token.statusCode).toBe(400);
    expect(token.json()).toMatchObject({error: 'invalid_grant'});
  });
});
