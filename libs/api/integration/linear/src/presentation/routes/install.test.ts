import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import {
  ConnectionSlugConflictError,
  type IntegrationConnection,
} from '@shipfox/api-integration-spi';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import type {LinearApiClient} from '#api/client.js';
import type {ConnectLinearInstallationInput} from '#core/install.js';
import {verifyLinearInstallState} from '#core/state.js';
import type {LinearTokenStore} from '#core/tokens.js';
import {createLinearIntegrationProvider} from '#index.js';

const requireWorkspaceMembershipMock = vi.fn(() => Promise.resolve());
let authenticatedMemberships: UserContextMembership[] = [];

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }

    setUserContext(
      request,
      buildUserContext({
        userId: 'user-1',
        email: 'user@example.com',
        memberships: authenticatedMemberships,
      }),
    );
    return Promise.resolve();
  },
};

function linearClient(overrides: Partial<LinearApiClient> = {}): LinearApiClient {
  return {
    exchangeAuthorizationCode: vi.fn(() =>
      Promise.resolve({
        accessToken: 'linear-access-token',
        refreshToken: 'linear-refresh-token',
        expiresAt: new Date('2026-07-07T13:00:00.000Z'),
        scopes: ['read', 'write', 'app:assignable', 'app:mentionable'],
      }),
    ),
    refreshAccessToken: vi.fn(() => {
      throw new Error('not used');
    }),
    revokeToken: vi.fn(() => Promise.resolve()),
    getIdentity: vi.fn(() =>
      Promise.resolve({
        appUserId: 'app-user-id',
        organizationId: 'org-id',
        organizationName: 'Acme',
        organizationUrlKey: 'acme',
      }),
    ),
    ...overrides,
  };
}

function connection(input: Partial<IntegrationConnection<'linear'>> = {}) {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provider: 'linear',
    externalAccountId: 'org-id',
    slug: 'linear_acme',
    displayName: 'Linear Acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...input,
    repositoryAccessMode: input.repositoryAccessMode ?? 'selected',
  } satisfies IntegrationConnection<'linear'>;
}

interface CreateTestAppOptions {
  linear?: LinearApiClient;
  tokenStore?: Pick<LinearTokenStore, 'storeTokens'> | undefined;
  agentTools?: boolean | undefined;
  existingConnection?: IntegrationConnection<'linear'> | undefined;
  connectLinearInstallation?:
    | ((input: ConnectLinearInstallationInput) => Promise<IntegrationConnection<'linear'>>)
    | undefined;
  disconnectLinearInstallation?: ((input: {connectionId: string}) => Promise<void>) | undefined;
}

async function createTestApp(options: CreateTestAppOptions = {}): Promise<FastifyInstance> {
  const agentTools = options.agentTools ?? true;
  const provider = createLinearIntegrationProvider({
    linear: options.linear ?? linearClient(),
    ...(agentTools
      ? {agentTools: {tokenStore: {getAccessToken: vi.fn(() => Promise.resolve('linear-token'))}}}
      : {}),
    routes: {
      tokenStore: options.tokenStore ?? {
        storeTokens: vi.fn(() => Promise.resolve()),
      },
      getExistingLinearConnection: vi.fn(() => Promise.resolve(options.existingConnection)),
      connectLinearInstallation:
        options.connectLinearInstallation ??
        vi.fn((input: ConnectLinearInstallationInput) =>
          Promise.resolve(
            connection({
              workspaceId: input.workspaceId,
              externalAccountId: input.organizationId,
              displayName: input.displayName,
            }),
          ),
        ),
      disconnectLinearInstallation:
        options.disconnectLinearInstallation ?? vi.fn(() => Promise.resolve()),
      requireActiveWorkspaceMembership: requireWorkspaceMembershipMock,
    },
  });
  const app = await createApp({
    auth: [fakeUserAuth],
    routes: provider.routes,
    swagger: false,
  });
  await app.ready();
  return app;
}

describe('Linear integration routes', () => {
  beforeEach(async () => {
    authenticatedMemberships = [];
    requireWorkspaceMembershipMock.mockClear();
    await closeApp();
  });

  afterEach(async () => {
    await closeApp();
  });

  it('returns an actor=app OAuth URL with signed workspace state', async () => {
    const app = await createTestApp();
    const workspaceId = crypto.randomUUID();
    authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/linear/install',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId},
    });

    const installUrl = new URL(res.json().install_url);
    const state = installUrl.searchParams.get('state');
    const claims = verifyLinearInstallState(state ?? '');
    expect(res.statusCode).toBe(200);
    expect(installUrl.origin + installUrl.pathname).toBe('https://linear.app/oauth/authorize');
    expect(installUrl.searchParams.get('client_id')).toBe('test-client-id');
    expect(installUrl.searchParams.get('redirect_uri')).toBe(
      'https://shipfox.example.com/integrations/linear/callback',
    );
    expect(installUrl.searchParams.get('response_type')).toBe('code');
    expect(installUrl.searchParams.get('actor')).toBe('app');
    expect(installUrl.searchParams.get('scope')).toBe('read,write,app:assignable,app:mentionable');
    expect(claims.workspaceId).toBe(workspaceId);
    expect(claims.userId).toBe('user-1');
  });

  it('handles a verified Linear callback and stores tokens for the connection', async () => {
    const tokenStore = {storeTokens: vi.fn(() => Promise.resolve())};
    const connectLinearInstallation = vi.fn((input: ConnectLinearInstallationInput) =>
      Promise.resolve(
        connection({
          id: '00000000-0000-4000-8000-000000000001',
          workspaceId: input.workspaceId,
          externalAccountId: input.organizationId,
          displayName: input.displayName,
        }),
      ),
    );
    const app = await createTestApp({tokenStore, connectLinearInstallation});
    const workspaceId = crypto.randomUUID();
    const state = await createInstallState(app, workspaceId);

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/linear/callback/api?code=code&state=${state}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      workspace_id: workspaceId,
      provider: 'linear',
      external_account_id: 'org-id',
      display_name: 'Linear Acme',
      lifecycle_status: 'active',
      capabilities: ['agent_tools'],
    });
    expect(connectLinearInstallation).toHaveBeenCalledWith({
      workspaceId,
      organizationId: 'org-id',
      organizationUrlKey: 'acme',
      appUserId: 'app-user-id',
      scopes: ['read', 'write', 'app:assignable', 'app:mentionable'],
      tokenExpiresAt: new Date('2026-07-07T13:00:00.000Z'),
      displayName: 'Linear Acme',
    });
    expect(tokenStore.storeTokens).toHaveBeenCalledWith({
      connectionId: '00000000-0000-4000-8000-000000000001',
      accessToken: 'linear-access-token',
      refreshToken: 'linear-refresh-token',
      editedBy: 'user-1',
    });
    expect(requireWorkspaceMembershipMock).toHaveBeenCalledWith({
      workspaceId,
      userId: 'user-1',
      memberships: [{workspaceId, role: 'admin', workspaceStatus: 'active'}],
    });
  });

  it('omits agent tools capability from callback connections when the adapter is not wired', async () => {
    const app = await createTestApp({agentTools: false});
    const workspaceId = crypto.randomUUID();
    const state = await createInstallState(app, workspaceId);

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/linear/callback/api?code=code&state=${state}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      provider: 'linear',
      capabilities: [],
    });
  });

  it('rejects tampered callback state', async () => {
    const app = await createTestApp();
    const workspaceId = crypto.randomUUID();
    const state = await createInstallState(app, workspaceId);

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/linear/callback/api?code=code&state=${state}x`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid-linear-install-state');
  });

  it('handles Linear OAuth error callbacks after validating state', async () => {
    const app = await createTestApp();
    const workspaceId = crypto.randomUUID();
    const state = await createInstallState(app, workspaceId);

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/linear/callback/api?error=access_denied&error_description=Denied&state=${state}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: 'linear-oauth-callback-error',
      details: {error: 'access_denied', error_description: 'Denied'},
    });
    expect(requireWorkspaceMembershipMock).toHaveBeenCalledWith({
      workspaceId,
      userId: 'user-1',
      memberships: [{workspaceId, role: 'admin', workspaceStatus: 'active'}],
    });
  });

  it('rejects callbacks for a Linear organization linked to another workspace and revokes tokens', async () => {
    const revokeToken = vi.fn(() => Promise.resolve());
    const app = await createTestApp({
      linear: linearClient({revokeToken}),
      existingConnection: connection({workspaceId: crypto.randomUUID()}),
    });
    const workspaceId = crypto.randomUUID();
    const state = await createInstallState(app, workspaceId);

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/linear/callback/api?code=code&state=${state}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('linear-installation-already-linked');
    expect(revokeToken).toHaveBeenCalledWith({
      token: 'linear-refresh-token',
      tokenTypeHint: 'refresh_token',
    });
    expect(revokeToken).toHaveBeenCalledWith({
      token: 'linear-access-token',
      tokenTypeHint: 'access_token',
    });
  });

  it('revokes tokens when Linear identity lookup fails after authorization', async () => {
    const revokeToken = vi.fn(() => Promise.resolve());
    const app = await createTestApp({
      linear: linearClient({
        revokeToken,
        getIdentity: vi.fn(() => Promise.reject(new Error('Linear unavailable'))),
      }),
    });
    const state = await createInstallState(app, crypto.randomUUID());

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/linear/callback/api?code=code&state=${state}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(500);
    expect(revokeToken).toHaveBeenCalledWith({
      token: 'linear-refresh-token',
      tokenTypeHint: 'refresh_token',
    });
    expect(revokeToken).toHaveBeenCalledWith({
      token: 'linear-access-token',
      tokenTypeHint: 'access_token',
    });
  });

  it('rejects callbacks when Linear omits required scopes and revokes tokens', async () => {
    const revokeToken = vi.fn(() => Promise.resolve());
    const app = await createTestApp({
      linear: linearClient({
        revokeToken,
        exchangeAuthorizationCode: vi.fn(() =>
          Promise.resolve({
            accessToken: 'linear-access-token',
            refreshToken: 'linear-refresh-token',
            expiresAt: new Date('2026-07-07T13:00:00.000Z'),
            scopes: ['read'],
          }),
        ),
      }),
    });
    const state = await createInstallState(app, crypto.randomUUID());

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/linear/callback/api?code=code&state=${state}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: 'linear-authorization-scope-mismatch',
      details: {missing_scopes: ['write', 'app:assignable', 'app:mentionable']},
    });
    expect(revokeToken).toHaveBeenCalledTimes(2);
  });

  it('compensates a new connection when token storage fails', async () => {
    const connectionId = '00000000-0000-4000-8000-000000000003';
    const disconnectLinearInstallation = vi.fn(() => Promise.resolve());
    const revokeToken = vi.fn(() => Promise.resolve());
    const app = await createTestApp({
      linear: linearClient({revokeToken}),
      tokenStore: {storeTokens: vi.fn(() => Promise.reject(new Error('secret store down')))},
      connectLinearInstallation: vi.fn((input: ConnectLinearInstallationInput) =>
        Promise.resolve(
          connection({
            id: connectionId,
            workspaceId: input.workspaceId,
            externalAccountId: input.organizationId,
            displayName: input.displayName,
          }),
        ),
      ),
      disconnectLinearInstallation,
    });
    const state = await createInstallState(app, crypto.randomUUID());

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/linear/callback/api?code=code&state=${state}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(500);
    expect(revokeToken).toHaveBeenCalledTimes(2);
    expect(disconnectLinearInstallation).toHaveBeenCalledWith({connectionId});
  });

  it('reconnects an existing workspace connection and refreshes stored tokens', async () => {
    const workspaceId = crypto.randomUUID();
    const existingConnection = connection({
      id: '00000000-0000-4000-8000-000000000002',
      workspaceId,
    });
    const tokenStore = {storeTokens: vi.fn(() => Promise.resolve())};
    const connectLinearInstallation = vi.fn(() => Promise.resolve(existingConnection));
    const app = await createTestApp({
      tokenStore,
      existingConnection,
      connectLinearInstallation,
    });
    const state = await createInstallState(app, workspaceId);

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/linear/callback/api?code=code&state=${state}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(existingConnection.id);
    expect(connectLinearInstallation).toHaveBeenCalledTimes(1);
    expect(tokenStore.storeTokens).toHaveBeenCalledWith(
      expect.objectContaining({connectionId: existingConnection.id}),
    );
  });

  it('returns 409 when connection slug allocation conflicts repeatedly', async () => {
    const app = await createTestApp({
      connectLinearInstallation: vi.fn(() =>
        Promise.reject(new ConnectionSlugConflictError(new Error('duplicate slug'))),
      ),
    });
    const state = await createInstallState(app, crypto.randomUUID());

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/linear/callback/api?code=code&state=${state}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('slug-conflict');
  });
});

async function createInstallState(app: FastifyInstance, workspaceId: string): Promise<string> {
  authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
  const res = await app.inject({
    method: 'POST',
    url: '/integrations/linear/install',
    headers: {authorization: 'Bearer user'},
    payload: {workspace_id: workspaceId},
  });
  const installUrl = new URL(res.json().install_url);
  const state = installUrl.searchParams.get('state');
  if (!state) throw new Error('Install URL did not include state');
  return encodeURIComponent(state);
}
