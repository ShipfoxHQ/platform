import type {UserContextMembership} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {SlackApiClient} from '#api/client.js';
import type {ConnectSlackInstallationInput} from './install.js';
import {handleSlackCallback} from './install.js';
import {signSlackInstallState} from './state.js';

function authorization(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: 'xoxb-token',
    botUserId: 'U123',
    appId: 'A123',
    teamId: 'T123',
    teamName: 'Acme',
    scopes: [
      'app_mentions:read',
      'im:history',
      'chat:write',
      'channels:history',
      'groups:history',
      'channels:read',
      'groups:read',
      'users:read',
      'reactions:read',
      'reactions:write',
      'commands',
    ],
    ...overrides,
  };
}

function connection(overrides: Partial<IntegrationConnection<'slack'>> = {}) {
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
    ...overrides,
  } satisfies IntegrationConnection<'slack'>;
}

function callbackParams(
  overrides: Partial<Parameters<typeof handleSlackCallback>[0]> = {},
): Parameters<typeof handleSlackCallback>[0] {
  const slack: SlackApiClient = {
    exchangeAuthorizationCode: vi.fn(() => Promise.resolve(authorization())),
    revokeToken: vi.fn(() => Promise.resolve()),
    callMethod: vi.fn(() => Promise.resolve({ok: true})),
  };
  return {
    slack,
    tokenStore: {storeTokens: vi.fn(() => Promise.resolve())},
    code: 'code',
    state: signSlackInstallState({
      workspaceId: '00000000-0000-4000-8000-000000000002',
      userId: 'user-1',
    }),
    sessionUserId: 'user-1',
    sessionMemberships: [
      {
        workspaceId: '00000000-0000-4000-8000-000000000002',
        role: 'admin',
        workspaceStatus: 'active',
      },
    ] satisfies UserContextMembership[],
    requireWorkspaceMembership: vi.fn(() => Promise.resolve()),
    getExistingSlackConnection: vi.fn(() => Promise.resolve(undefined)),
    connectSlackInstallation: vi.fn(() => Promise.resolve(connection())),
    disconnectSlackInstallation: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('handleSlackCallback', () => {
  it('connects a Slack installation and stores its bot token', async () => {
    const params = callbackParams();

    const result = await handleSlackCallback(params);

    expect(result).toMatchObject({provider: 'slack', externalAccountId: 'T123'});
    expect(params.connectSlackInstallation).toHaveBeenCalledWith({
      workspaceId: '00000000-0000-4000-8000-000000000002',
      teamId: 'T123',
      teamName: 'Acme',
      appId: 'A123',
      botUserId: 'U123',
      scopes: authorization().scopes,
      tokenExpiresAt: null,
      displayName: 'Slack Acme',
    } satisfies ConnectSlackInstallationInput);
    expect(params.tokenStore.storeTokens).toHaveBeenCalledWith({
      connectionId: '00000000-0000-4000-8000-000000000001',
      botToken: 'xoxb-token',
      editedBy: 'user-1',
    });
  });

  it('revokes the minted token when scopes do not match', async () => {
    const slack: SlackApiClient = {
      exchangeAuthorizationCode: vi.fn(() =>
        Promise.resolve(authorization({scopes: ['chat:write']})),
      ),
      revokeToken: vi.fn(() => Promise.resolve()),
      callMethod: vi.fn(() => Promise.resolve({ok: true})),
    };
    const params = callbackParams({slack});

    const result = handleSlackCallback(params);

    await expect(result).rejects.toThrow('missing required scopes');
    expect(slack.revokeToken).toHaveBeenCalledWith({token: 'xoxb-token'});
    expect(params.connectSlackInstallation).not.toHaveBeenCalled();
  });

  it('revokes a cross-workspace installation attempt', async () => {
    const params = callbackParams({
      getExistingSlackConnection: vi.fn(() =>
        Promise.resolve(connection({workspaceId: crypto.randomUUID()})),
      ),
    });

    const result = handleSlackCallback(params);

    await expect(result).rejects.toThrow('already linked');
    expect(params.slack.revokeToken).not.toHaveBeenCalled();
  });

  it('compensates a newly created connection when token storage fails', async () => {
    const params = callbackParams({
      tokenStore: {storeTokens: vi.fn(() => Promise.reject(new Error('store failed')))},
    });

    const result = handleSlackCallback(params);

    await expect(result).rejects.toThrow('store failed');
    expect(params.slack.revokeToken).toHaveBeenCalledWith({token: 'xoxb-token'});
    expect(params.disconnectSlackInstallation).toHaveBeenCalledWith({
      connectionId: connection().id,
    });
  });

  it('refreshes an existing connection token without disconnecting it on storage failure', async () => {
    const params = callbackParams({
      getExistingSlackConnection: vi.fn(() => Promise.resolve(connection())),
      tokenStore: {storeTokens: vi.fn(() => Promise.reject(new Error('store failed')))},
    });

    const result = handleSlackCallback(params);

    await expect(result).rejects.toThrow('store failed');
    expect(params.disconnectSlackInstallation).not.toHaveBeenCalled();
    expect(params.slack.revokeToken).not.toHaveBeenCalled();
  });
});
