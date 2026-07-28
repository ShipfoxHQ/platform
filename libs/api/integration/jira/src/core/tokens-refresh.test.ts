const {getInstallation, updateExpiry, withRefreshLock} = vi.hoisted(() => ({
  getInstallation: vi.fn(),
  updateExpiry: vi.fn(),
  withRefreshLock: vi.fn(async (_connectionId: string, fn: () => Promise<string>) => ({
    acquired: true as const,
    value: await fn(),
  })),
}));

vi.mock('#db/installations.js', () => ({
  getJiraInstallationByConnectionId: getInstallation,
  updateJiraInstallationTokenExpiry: updateExpiry,
  withJiraRefreshLock: withRefreshLock,
}));

import {JiraIntegrationProviderError, JiraTokenUnrefreshableError} from './errors.js';
import {createJiraTokenStore} from './tokens.js';

function createStore() {
  const values = new Map<string, string>();
  const secrets = {
    getSecret: vi.fn(async ({key}: {key: string}) => values.get(key) ?? null),
    setSecrets: vi.fn(({values: next}: {values: Record<string, string>}) => {
      for (const [key, value] of Object.entries(next)) values.set(key, value);
      return Promise.resolve();
    }),
  };
  const client = {
    exchangeAuthorizationCode: vi.fn(),
    refreshAccessToken: vi.fn(),
    getAccessibleResources: vi.fn(),
    getMyself: vi.fn(),
    registerDynamicWebhook: vi.fn(),
    deleteDynamicWebhook: vi.fn(),
  };
  const markConnectionError = vi.fn().mockResolvedValue(undefined);
  const connectionId = crypto.randomUUID();
  const store = createJiraTokenStore({
    resolveConnection: vi.fn().mockResolvedValue({workspaceId: crypto.randomUUID()}),
    secrets,
    client,
    markConnectionError,
  });
  return {client, connectionId, markConnectionError, secrets, store, values};
}

describe('Jira token refresh', () => {
  beforeEach(() => {
    getInstallation.mockResolvedValue({tokenExpiresAt: new Date(0)});
    updateExpiry.mockResolvedValue(undefined);
    withRefreshLock.mockImplementation(async (_connectionId, fn) => ({
      acquired: true,
      value: await fn(),
    }));
  });

  it('rotates and persists both tokens when the access token expires', async () => {
    const {client, connectionId, secrets, store, values} = createStore();
    await store.storeTokens({connectionId, accessToken: 'access-0', refreshToken: 'refresh-0'});
    client.refreshAccessToken.mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: new Date('2030-01-01'),
      scopes: ['read:jira-work'],
    });

    const result = await store.getAccessToken({connectionId});

    expect(result).toBe('access-1');
    expect(client.refreshAccessToken).toHaveBeenCalledWith({refreshToken: 'refresh-0'});
    expect(values.get('ACCESS_TOKEN')).toBe('access-1');
    expect(values.get('REFRESH_TOKEN')).toBe('refresh-1');
    expect(secrets.setSecrets).toHaveBeenCalledTimes(2);
    expect(updateExpiry).toHaveBeenCalledWith(expect.objectContaining({connectionId}));
  });

  it('marks only credential failures as connection errors', async () => {
    const {client, connectionId, markConnectionError, store} = createStore();
    await store.storeTokens({connectionId, accessToken: 'access-0', refreshToken: 'refresh-0'});
    client.refreshAccessToken.mockRejectedValue(
      new JiraIntegrationProviderError('access-denied', 'invalid grant'),
    );

    const result = store.getAccessToken({connectionId});

    await expect(result).rejects.toBeInstanceOf(JiraIntegrationProviderError);
    expect(markConnectionError).toHaveBeenCalledWith({connectionId});
  });

  it('requires a refresh token once the access token expires', async () => {
    const {connectionId, store} = createStore();
    await store.storeTokens({connectionId, accessToken: 'access-0'});

    const result = store.getAccessToken({connectionId});

    await expect(result).rejects.toBeInstanceOf(JiraTokenUnrefreshableError);
  });

  it('does not return an expired token when another process owns the refresh lock', async () => {
    const {connectionId, store} = createStore();
    await store.storeTokens({connectionId, accessToken: 'access-0', refreshToken: 'refresh-0'});
    withRefreshLock.mockResolvedValue({acquired: false} as never);

    const result = store.getAccessToken({connectionId});

    await expect(result).rejects.toMatchObject({reason: 'provider-unavailable'});
  });
});
