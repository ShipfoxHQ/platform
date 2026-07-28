import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import type {SlackApiClient} from '#api/client.js';
import {SlackTokenRotationUnsupportedError} from '#core/errors.js';
import type {ConnectSlackInstallationInput} from '#core/install.js';
import {verifySlackInstallState} from '#core/state.js';
import type {SlackTokenStore} from '#core/tokens.js';
import {createSlackIntegrationProvider} from '#index.js';

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

function slackClient(overrides: Partial<SlackApiClient> = {}): SlackApiClient {
  return {
    exchangeAuthorizationCode: vi.fn(() =>
      Promise.resolve({
        accessToken: 'xoxb-token',
        botUserId: 'U123',
        appId: 'A123',
        teamId: 'T123',
        teamName: 'Acme',
        scopes: [
          'app_mentions:read',
          'im:history',
          'im:read',
          'mpim:history',
          'mpim:read',
          'chat:write',
          'channels:history',
          'groups:history',
          'channels:read',
          'groups:read',
          'users:read',
          'reactions:read',
          'reactions:write',
          'canvases:write',
          'commands',
        ],
      }),
    ),
    revokeToken: vi.fn(() => Promise.resolve()),
    callMethod: vi.fn(() => Promise.resolve({ok: true})),
    ...overrides,
  };
}

function connection(input: Partial<IntegrationConnection<'slack'>> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    provider: 'slack',
    externalAccountId: 'T123',
    slug: 'slack_acme',
    displayName: 'Slack Acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...input,
  } satisfies IntegrationConnection<'slack'>;
}

async function createTestApp(
  options: {
    slack?: SlackApiClient | undefined;
    tokenStore?: Pick<SlackTokenStore, 'storeTokens'> | undefined;
    agentTools?: {tokenStore: Pick<SlackTokenStore, 'getAccessToken'>} | undefined;
    connectSlackInstallation?:
      | ((input: ConnectSlackInstallationInput) => Promise<IntegrationConnection<'slack'>>)
      | undefined;
  } = {},
): Promise<FastifyInstance> {
  const provider = createSlackIntegrationProvider({
    slack: options.slack ?? slackClient(),
    agentTools: options.agentTools,
    routes: {
      tokenStore: options.tokenStore ?? {storeTokens: vi.fn(() => Promise.resolve())},
      getExistingSlackConnection: vi.fn(() => Promise.resolve(undefined)),
      connectSlackInstallation:
        options.connectSlackInstallation ??
        vi.fn((input: ConnectSlackInstallationInput) =>
          Promise.resolve(connection({workspaceId: input.workspaceId})),
        ),
      disconnectSlackInstallation: vi.fn(() => Promise.resolve()),
      requireActiveWorkspaceMembership: requireWorkspaceMembershipMock,
    },
  });
  const app = await createApp({auth: [fakeUserAuth], routes: provider.routes, swagger: false});
  await app.ready();
  return app;
}

describe('Slack integration routes', () => {
  beforeEach(async () => {
    authenticatedMemberships = [];
    await closeApp();
  });

  afterEach(async () => {
    await closeApp();
  });

  it('returns Slack’s bot-only OAuth URL with signed workspace state', async () => {
    const app = await createTestApp();
    const workspaceId = '00000000-0000-4000-8000-000000000002';
    authenticatedMemberships = [{workspaceId, role: 'admin'}];

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/slack/install',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId},
    });

    const installUrl = new URL(res.json().install_url);
    const state = installUrl.searchParams.get('state');
    expect(res.statusCode).toBe(200);
    expect(installUrl.origin + installUrl.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(installUrl.searchParams.get('scope')).toContain('app_mentions:read');
    expect(installUrl.searchParams.has('user_scope')).toBe(false);
    expect(verifySlackInstallState(state ?? '')).toEqual({workspaceId, userId: 'user-1'});
  });

  it('rejects install requests for a workspace the actor cannot access', async () => {
    const app = await createTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/slack/install',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: '00000000-0000-4000-8000-000000000002'},
    });

    expect(res.statusCode).toBe(403);
  });

  it.each([
    {
      capability: 'without agent tools',
      agentTools: undefined,
      expectedCapabilities: [],
    },
    {
      capability: 'with agent tools',
      agentTools: {tokenStore: {getAccessToken: vi.fn(() => Promise.resolve('xoxb-token'))}},
      expectedCapabilities: ['agent_tools'],
    },
  ])('returns the connected Slack connection $capability', async ({
    agentTools,
    expectedCapabilities,
  }) => {
    const tokenStore = {storeTokens: vi.fn(() => Promise.resolve())};
    const app = await createTestApp({tokenStore, agentTools});
    const workspaceId = '00000000-0000-4000-8000-000000000002';
    authenticatedMemberships = [{workspaceId, role: 'admin'}];
    const install = await app.inject({
      method: 'POST',
      url: '/integrations/slack/install',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId},
    });
    const state = new URL(install.json().install_url).searchParams.get('state');

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/slack/callback/api?code=code&state=${state}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({provider: 'slack', capabilities: expectedCapabilities});
    expect(tokenStore.storeTokens).toHaveBeenCalledWith({
      connectionId: '00000000-0000-4000-8000-000000000001',
      botToken: 'xoxb-token',
      editedBy: 'user-1',
    });
  });

  it('rejects a callback whose OAuth response enables token rotation', async () => {
    const tokenStore = {storeTokens: vi.fn(() => Promise.resolve())};
    const slack = slackClient({
      exchangeAuthorizationCode: vi.fn(() =>
        Promise.reject(new SlackTokenRotationUnsupportedError()),
      ),
    });
    const app = await createTestApp({slack, tokenStore});
    const workspaceId = '00000000-0000-4000-8000-000000000002';
    authenticatedMemberships = [{workspaceId, role: 'admin'}];
    const install = await app.inject({
      method: 'POST',
      url: '/integrations/slack/install',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId},
    });
    const state = new URL(install.json().install_url).searchParams.get('state');

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/slack/callback/api?code=code&state=${state}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('slack-token-rotation-unsupported');
    expect(tokenStore.storeTokens).not.toHaveBeenCalled();
  });
});
