import {type JiraInstallationLock, withJiraInstallationLock} from '#db/installations.js';
import {
  JiraOfflineAccessNotGrantedError,
  JiraPendingSelectionNotFoundError,
  JiraSiteSelectionMismatchError,
} from './errors.js';
import {handleJiraCallback, handleJiraSiteSelection} from './install.js';
import {signJiraInstallState} from './state.js';

function createParams() {
  const workspaceId = crypto.randomUUID();
  const state = signJiraInstallState({workspaceId, userId: 'user-1'});
  const jira = {
    exchangeAuthorizationCode: vi.fn().mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: new Date(),
      scopes: [],
    }),
    getAccessibleResources: vi.fn(),
    getMyself: vi.fn().mockResolvedValue({accountId: 'account-1'}),
    refreshAccessToken: vi.fn(),
    registerDynamicWebhook: vi.fn(),
    refreshDynamicWebhooks: vi.fn(),
    deleteDynamicWebhooks: vi.fn(),
    deleteDynamicWebhook: vi.fn(),
  };
  const tokenStore = {storeTokens: vi.fn().mockResolvedValue(undefined)};
  const pendingStore = {
    save: vi.fn().mockResolvedValue(undefined),
    load: vi.fn(),
    clear: vi.fn().mockResolvedValue(undefined),
  };
  const connectJiraInstallation = vi
    .fn()
    .mockResolvedValue({id: 'connection-1', workspaceId, provider: 'jira'});
  const registerJiraWebhook = vi.fn().mockImplementation(async ({onRegistrationSuccess}) => {
    await onRegistrationSuccess?.({});
  });
  const markConnectionActive = vi.fn().mockResolvedValue(undefined);
  const markConnectionError = vi.fn().mockResolvedValue(undefined);
  const withJiraInstallationLock: JiraInstallationLock = async (_key, fn) => fn();
  return {
    workspaceId,
    state,
    jira,
    tokenStore,
    pendingStore,
    connectJiraInstallation,
    registerJiraWebhook,
    markConnectionActive,
    markConnectionError,
    withJiraInstallationLock,
    code: 'code',
    sessionUserId: 'user-1',
    sessionMemberships: [],
    requireWorkspaceMembership: vi.fn().mockResolvedValue(undefined),
    getExistingJiraConnection: vi.fn().mockResolvedValue(undefined),
    disconnectJiraInstallation: vi.fn().mockResolvedValue(undefined),
  };
}

describe('Jira OAuth installation', () => {
  it('connects a single granted site and stores its tokens', async () => {
    const params = createParams();
    params.jira.getAccessibleResources.mockResolvedValue([
      {
        cloudId: 'cloud-1',
        name: 'Acme',
        url: 'https://acme.atlassian.net',
        scopes: ['read:jira-work'],
      },
    ]);

    const result = await handleJiraCallback(params);

    expect(result).toMatchObject({id: 'connection-1'});
    expect(params.connectJiraInstallation).toHaveBeenCalledWith(
      expect.objectContaining({cloudId: 'cloud-1'}),
    );
    expect(params.tokenStore.storeTokens).toHaveBeenCalledWith(
      expect.objectContaining({connectionId: 'connection-1', refreshToken: 'refresh'}),
    );
    expect(params.markConnectionActive).toHaveBeenCalledWith({connectionId: 'connection-1'});
  });

  it('stores a multi-site grant until the selected site completes', async () => {
    const params = createParams();
    const sites = [
      {
        cloudId: 'cloud-1',
        name: 'Acme',
        url: 'https://acme.atlassian.net',
        scopes: ['read:jira-work'],
      },
      {
        cloudId: 'cloud-2',
        name: 'Beta',
        url: 'https://beta.atlassian.net',
        scopes: ['read:issue:jira'],
      },
    ];
    params.jira.getAccessibleResources.mockResolvedValue(sites);

    const callback = await handleJiraCallback(params);
    params.pendingStore.load.mockResolvedValue({
      authorization: {accessToken: 'access', refreshToken: 'refresh', scopes: []},
      sites,
    });
    const completed = await handleJiraSiteSelection({...params, cloudId: 'cloud-2'});

    expect(callback).toEqual({sites});
    expect(params.pendingStore.save).toHaveBeenCalled();
    expect(completed).toMatchObject({id: 'connection-1'});
    expect(params.pendingStore.clear).toHaveBeenCalledWith({
      workspaceId: params.workspaceId,
      state: params.state,
    });
  });

  it('rejects missing refresh tokens and invalid pending selections', async () => {
    const missingRefresh = createParams();
    missingRefresh.jira.exchangeAuthorizationCode.mockResolvedValue({
      accessToken: 'access',
      scopes: [],
    });
    const missingPending = createParams();
    missingPending.pendingStore.load.mockResolvedValue(undefined);
    const mismatchedSite = createParams();
    mismatchedSite.pendingStore.load.mockResolvedValue({
      authorization: {accessToken: 'access', refreshToken: 'refresh', scopes: []},
      sites: [],
    });

    await expect(handleJiraCallback(missingRefresh)).rejects.toBeInstanceOf(
      JiraOfflineAccessNotGrantedError,
    );
    await expect(
      handleJiraSiteSelection({...missingPending, cloudId: 'cloud-1'}),
    ).rejects.toBeInstanceOf(JiraPendingSelectionNotFoundError);
    await expect(
      handleJiraSiteSelection({...mismatchedSite, cloudId: 'cloud-1'}),
    ).rejects.toBeInstanceOf(JiraSiteSelectionMismatchError);
  });

  it('marks the connection in error while retaining state when registration fails', async () => {
    const params = createParams();
    params.jira.getAccessibleResources.mockResolvedValue([
      {
        cloudId: 'cloud-1',
        name: 'Acme',
        url: 'https://acme.atlassian.net',
        scopes: ['read:jira-work'],
      },
    ]);
    const registrationError = new Error('Jira rejected the webhook');
    params.registerJiraWebhook.mockRejectedValue(registrationError);
    await expect(handleJiraCallback(params)).rejects.toBe(registrationError);
    expect(params.tokenStore.storeTokens).toHaveBeenCalled();
    expect(params.disconnectJiraInstallation).not.toHaveBeenCalled();
    expect(params.markConnectionError).toHaveBeenCalledWith({connectionId: 'connection-1'});
  });

  it('does not overwrite an existing installation when token storage fails', async () => {
    const params = createParams();
    params.jira.getAccessibleResources.mockResolvedValue([
      {
        cloudId: 'cloud-1',
        name: 'Acme',
        url: 'https://acme.atlassian.net',
        scopes: ['read:jira-work'],
      },
    ]);
    const existing = {
      id: 'connection-1',
      workspaceId: params.workspaceId,
      provider: 'jira',
    } as const;
    params.getExistingJiraConnection.mockResolvedValue(existing);
    const storageError = new Error('secret storage unavailable');
    params.tokenStore.storeTokens.mockRejectedValue(storageError);
    params.markConnectionError
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(undefined);

    await expect(handleJiraCallback(params)).rejects.toBe(storageError);

    expect(params.connectJiraInstallation).not.toHaveBeenCalled();
    expect(params.markConnectionError).toHaveBeenCalledTimes(2);
    expect(params.markConnectionError).toHaveBeenNthCalledWith(1, {connectionId: existing.id});
    expect(params.markConnectionError).toHaveBeenNthCalledWith(2, {connectionId: existing.id});
    expect(params.disconnectJiraInstallation).not.toHaveBeenCalled();
  });

  it('falls back to a second error-state write when the registration callback cannot persist it', async () => {
    const params = createParams();
    params.jira.getAccessibleResources.mockResolvedValue([
      {
        cloudId: 'cloud-1',
        name: 'Acme',
        url: 'https://acme.atlassian.net',
        scopes: ['read:jira-work'],
      },
    ]);
    const registrationError = new Error('Jira rejected the webhook');
    params.registerJiraWebhook.mockImplementation(async ({onRegistrationFailure}) => {
      await onRegistrationFailure?.({});
      throw registrationError;
    });
    params.markConnectionError
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(undefined);

    await expect(handleJiraCallback(params)).rejects.toBe(registrationError);

    expect(params.markConnectionError).toHaveBeenCalledTimes(2);
    expect(params.markConnectionError).toHaveBeenNthCalledWith(1, {connectionId: 'connection-1'});
    expect(params.markConnectionError).toHaveBeenNthCalledWith(2, {connectionId: 'connection-1'});
  });

  it('serializes the complete same-site replacement before allowing another callback to proceed', async () => {
    const first = createParams();
    const second = createParams();
    second.workspaceId = first.workspaceId;
    second.state = signJiraInstallState({workspaceId: first.workspaceId, userId: 'user-1'});
    const sites = [
      {
        cloudId: 'cloud-1',
        name: 'Acme',
        url: 'https://acme.atlassian.net',
        scopes: ['read:jira-work'],
      },
    ];
    const connection = {id: 'connection-1', workspaceId: first.workspaceId, provider: 'jira'};
    const getExisting = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue(connection);
    const storeTokens = vi.fn().mockResolvedValue(undefined);
    const register = vi.fn();
    const events: string[] = [];
    let releaseFirstRegistration!: () => void;
    const firstRegistrationReady = new Promise<void>((resolve) => {
      releaseFirstRegistration = resolve;
    });

    first.jira.getAccessibleResources.mockResolvedValue(sites);
    second.jira.getAccessibleResources.mockResolvedValue(sites);
    first.jira.getMyself.mockResolvedValue({accountId: 'account-1'});
    second.jira.getMyself.mockResolvedValue({accountId: 'account-2'});
    first.jira.exchangeAuthorizationCode.mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      scopes: [],
    });
    second.jira.exchangeAuthorizationCode.mockResolvedValue({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      scopes: [],
    });
    getExisting.mockImplementation(() => {
      events.push('get-existing');
      return Promise.resolve(connect.mock.calls.length > 0 ? connection : undefined);
    });
    connect.mockImplementation((input) => {
      events.push(`connect:${input.authorizingAccountId}`);
      return Promise.resolve(connection);
    });
    storeTokens.mockImplementation(({accessToken}) => {
      events.push(`store:${accessToken}`);
      return Promise.resolve();
    });
    register.mockImplementation(async ({accessToken, onRegistrationSuccess}) => {
      events.push(`register:${accessToken}`);
      if (accessToken === 'access-1') await firstRegistrationReady;
      await onRegistrationSuccess?.({});
    });

    for (const params of [first, second]) {
      params.getExistingJiraConnection = getExisting;
      params.connectJiraInstallation = connect;
      params.tokenStore.storeTokens = storeTokens;
      params.registerJiraWebhook = register;
    }

    first.withJiraInstallationLock = withJiraInstallationLock;
    second.withJiraInstallationLock = withJiraInstallationLock;

    const firstCallback = handleJiraCallback(first);
    await vi.waitFor(() =>
      expect(register).toHaveBeenCalledWith(expect.objectContaining({accessToken: 'access-1'})),
    );
    const secondCallback = handleJiraCallback(second);
    await Promise.resolve();
    expect(getExisting).toHaveBeenCalledTimes(1);

    releaseFirstRegistration();
    await expect(firstCallback).resolves.toMatchObject({id: 'connection-1'});
    await expect(secondCallback).resolves.toMatchObject({id: 'connection-1'});

    expect(events).toEqual([
      'get-existing',
      'connect:account-1',
      'store:access-1',
      'register:access-1',
      'get-existing',
      'store:access-2',
      'connect:account-2',
      'register:access-2',
    ]);
  });
});
