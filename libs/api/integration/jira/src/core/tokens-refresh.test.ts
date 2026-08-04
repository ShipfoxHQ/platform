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
import {createJiraTokenStore, type JiraConnectionResolverResult} from './tokens.js';

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
  const workspaceId = crypto.randomUUID();
  const resolveConnection = vi.fn().mockResolvedValue({workspaceId, lifecycleStatus: 'active'});
  const store = createJiraTokenStore({
    resolveConnection,
    secrets,
    client,
    markConnectionError,
  });
  return {
    client,
    connectionId,
    markConnectionError,
    resolveConnection,
    secrets,
    store,
    values,
    workspaceId,
  };
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

  it('marks timeout failures as requiring reconnect because refresh state is unknown', async () => {
    const {client, connectionId, markConnectionError, store} = createStore();
    await store.storeTokens({connectionId, accessToken: 'access-0', refreshToken: 'refresh-0'});
    client.refreshAccessToken.mockRejectedValue(
      new JiraIntegrationProviderError('timeout', 'refresh timed out'),
    );

    const result = store.getAccessToken({connectionId});

    await expect(result).rejects.toMatchObject({reason: 'timeout'});
    expect(markConnectionError).toHaveBeenCalledWith({connectionId});
  });

  it('does not retry a refresh after the connection enters an error state', async () => {
    const {client, connectionId, store} = createStore();
    await store.storeTokens({connectionId, accessToken: 'access-0', refreshToken: 'refresh-0'});
    client.refreshAccessToken.mockRejectedValue(
      new JiraIntegrationProviderError('timeout', 'refresh timed out'),
    );

    await expect(store.getAccessToken({connectionId})).rejects.toMatchObject({reason: 'timeout'});

    await expect(store.getAccessToken({connectionId})).rejects.toBeInstanceOf(
      JiraTokenUnrefreshableError,
    );
    expect(client.refreshAccessToken).toHaveBeenCalledOnce();
  });

  it('allows a reconnect to clear the unknown refresh state', async () => {
    const {client, connectionId, store} = createStore();
    await store.storeTokens({connectionId, accessToken: 'access-0', refreshToken: 'refresh-0'});
    client.refreshAccessToken.mockRejectedValue(
      new JiraIntegrationProviderError('timeout', 'refresh timed out'),
    );

    await expect(store.getAccessToken({connectionId})).rejects.toMatchObject({reason: 'timeout'});

    await store.storeTokens({connectionId, accessToken: 'access-1', refreshToken: 'refresh-1'});
    getInstallation.mockResolvedValue({tokenExpiresAt: null});

    await expect(store.getAccessToken({connectionId})).resolves.toBe('access-1');
  });

  it('ignores a terminal refresh result from before a reconnect', async () => {
    const {client, connectionId, markConnectionError, store} = createStore();
    await store.storeTokens({connectionId, accessToken: 'access-0', refreshToken: 'refresh-0'});
    let rejectRefresh!: (error: unknown) => void;
    client.refreshAccessToken.mockImplementation(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectRefresh = reject;
        }),
    );

    const staleRefresh = store.getAccessToken({connectionId});
    await vi.waitFor(() => expect(client.refreshAccessToken).toHaveBeenCalledOnce());

    await store.storeTokens({connectionId, accessToken: 'access-1', refreshToken: 'refresh-1'});
    getInstallation.mockResolvedValue({tokenExpiresAt: null});
    await expect(store.getAccessToken({connectionId})).resolves.toBe('access-1');

    rejectRefresh(new JiraIntegrationProviderError('timeout', 'refresh timed out'));
    await expect(staleRefresh).rejects.toMatchObject({reason: 'timeout'});
    expect(markConnectionError).not.toHaveBeenCalled();
    await expect(store.getAccessToken({connectionId})).resolves.toBe('access-1');
  });

  it('serializes connection error updates with reconnect credential writes', async () => {
    const {client, connectionId, markConnectionError, store} = createStore();
    await store.storeTokens({connectionId, accessToken: 'access-0', refreshToken: 'refresh-0'});
    let releaseError!: () => void;
    let errorStarted!: () => void;
    const errorCanFinish = new Promise<void>((resolve) => {
      releaseError = resolve;
    });
    const errorUpdateStarted = new Promise<void>((resolve) => {
      errorStarted = resolve;
    });
    markConnectionError.mockImplementation(async () => {
      errorStarted();
      await errorCanFinish;
    });
    client.refreshAccessToken.mockRejectedValue(
      new JiraIntegrationProviderError('access-denied', 'invalid grant'),
    );

    const staleRefresh = store.getAccessToken({connectionId});
    await errorUpdateStarted;

    let reconnectFinished = false;
    const reconnect = store
      .storeTokens({connectionId, accessToken: 'access-1', refreshToken: 'refresh-1'})
      .then(() => {
        reconnectFinished = true;
      });
    await Promise.resolve();
    expect(reconnectFinished).toBe(false);

    releaseError();
    await expect(staleRefresh).rejects.toMatchObject({reason: 'access-denied'});
    await reconnect;
    expect(markConnectionError).toHaveBeenCalledOnce();
  });

  it('waits for reconnect credentials before starting another refresh', async () => {
    const {client, connectionId, resolveConnection, secrets, store, values, workspaceId} =
      createStore();
    await store.storeTokens({connectionId, accessToken: 'access-0', refreshToken: 'refresh-0'});
    let releaseConnection!: () => void;
    let connectionStarted!: () => void;
    const connectionCanFinish = new Promise<void>((resolve) => {
      releaseConnection = resolve;
    });
    const connectionLookupStarted = new Promise<void>((resolve) => {
      connectionStarted = resolve;
    });
    resolveConnection.mockImplementationOnce(async () => {
      connectionStarted();
      await connectionCanFinish;
      return {workspaceId, lifecycleStatus: 'active'};
    });
    let releaseReconnect!: () => void;
    let reconnectStarted!: () => void;
    const reconnectCanFinish = new Promise<void>((resolve) => {
      releaseReconnect = resolve;
    });
    const reconnectWriteStarted = new Promise<void>((resolve) => {
      reconnectStarted = resolve;
    });
    secrets.setSecrets.mockImplementation(
      async ({values: next}: {values: Record<string, string>}) => {
        if (next.ACCESS_TOKEN === 'access-1') {
          reconnectStarted();
          await reconnectCanFinish;
        }
        for (const [key, value] of Object.entries(next)) values.set(key, value);
      },
    );

    const accessToken = store.getAccessToken({connectionId});
    await connectionLookupStarted;
    const reconnect = store.storeTokens({
      connectionId,
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
    await reconnectWriteStarted;

    releaseConnection();
    await Promise.resolve();
    await Promise.resolve();
    expect(client.refreshAccessToken).not.toHaveBeenCalled();

    getInstallation.mockResolvedValue({tokenExpiresAt: null});
    releaseReconnect();
    await reconnect;
    await expect(accessToken).resolves.toBe('access-1');
    expect(client.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('fails closed when a connection resolver omits its lifecycle status', async () => {
    const {connectionId, resolveConnection, store} = createStore();
    await store.storeTokens({connectionId, accessToken: 'access-0', refreshToken: 'refresh-0'});
    resolveConnection.mockResolvedValue({
      workspaceId: crypto.randomUUID(),
    } as unknown as JiraConnectionResolverResult);

    await expect(store.getAccessToken({connectionId})).rejects.toBeInstanceOf(
      JiraTokenUnrefreshableError,
    );
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
