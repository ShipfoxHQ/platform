import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {GithubApiClient} from '#api/client.js';
import {
  GithubInstallationAlreadyLinkedError,
  GithubInstallationNotAuthorizedError,
  GithubInstallStateActorMismatchError,
} from './errors.js';
import {handleGithubCallback} from './install.js';
import {signGithubInstallState} from './state.js';

function githubClient(overrides: Partial<GithubApiClient> = {}): GithubApiClient {
  return {
    exchangeOAuthCode: vi.fn(() => Promise.resolve('user-token')),
    listUserInstallations: vi.fn(({cursor}) =>
      Promise.resolve({
        installationIds: cursor ? [123] : [999],
        nextCursor: cursor ? null : '2',
      }),
    ),
    getInstallation: vi.fn(() =>
      Promise.resolve({
        id: 123,
        account: {login: 'shipfox', type: 'Organization'},
        repositorySelection: 'all',
        suspendedAt: null,
        htmlUrl: 'https://github.com/apps/shipfox/installations/123',
        raw: {id: 123},
      }),
    ),
    listInstallationRepositories: vi.fn(() =>
      Promise.resolve({repositories: [], nextCursor: null}),
    ),
    getRepository: vi.fn(() => {
      throw new Error('not used');
    }),
    listRepositoryFiles: vi.fn(() => Promise.resolve({files: [], nextCursor: null})),
    fetchRepositoryFile: vi.fn(() => {
      throw new Error('not used');
    }),
    createInstallationAccessToken: vi.fn(() =>
      Promise.resolve({
        token: 'ghs_installationtoken',
        expiresAt: new Date('2026-06-10T12:00:00.000Z'),
      }),
    ),
    ...overrides,
  };
}

function githubConnection(
  overrides: Partial<IntegrationConnection<'github'>> = {},
): IntegrationConnection<'github'> {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provider: 'github',
    externalAccountId: '123',
    slug: 'github_shipfox',
    displayName: 'GitHub shipfox',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('handleGithubCallback', () => {
  it('paginates user installations before creating a connection', async () => {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const github = githubClient();
    const state = signGithubInstallState({workspaceId, userId});
    const requireWorkspaceMembership = vi.fn(() => Promise.resolve());
    const getExistingGithubConnection = vi.fn(() => Promise.resolve(undefined));
    const connectGithubInstallation = vi.fn(() => Promise.resolve(githubConnection({workspaceId})));

    const result = await handleGithubCallback({
      github,
      code: 'code',
      installationId: 123,
      state,
      sessionUserId: userId,
      sessionMemberships: [],
      requireWorkspaceMembership,
      getExistingGithubConnection,
      connectGithubInstallation,
    });

    expect(result.externalAccountId).toBe('123');
    expect(github.listUserInstallations).toHaveBeenCalledTimes(2);
    expect(requireWorkspaceMembership).toHaveBeenCalledWith({
      workspaceId,
      userId,
      memberships: [],
    });
    expect(getExistingGithubConnection).toHaveBeenCalledWith({installationId: '123'});
    expect(connectGithubInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        installationId: '123',
        displayName: 'GitHub shipfox',
        installerUserId: userId,
        installation: expect.objectContaining({installerUserId: userId}),
      }),
    );
  });

  it('rejects spoofed installation ids', async () => {
    const userId = crypto.randomUUID();
    const state = signGithubInstallState({workspaceId: crypto.randomUUID(), userId});
    const github = githubClient({
      listUserInstallations: vi.fn(() =>
        Promise.resolve({installationIds: [999], nextCursor: null}),
      ),
    });

    const result = handleGithubCallback({
      github,
      code: 'code',
      installationId: 123,
      state,
      sessionUserId: userId,
      sessionMemberships: [],
      requireWorkspaceMembership: vi.fn(() => Promise.resolve()),
      getExistingGithubConnection: vi.fn(() => Promise.resolve(undefined)),
      connectGithubInstallation: vi.fn(() => {
        throw new Error('must not connect');
      }),
    });

    await expect(result).rejects.toBeInstanceOf(GithubInstallationNotAuthorizedError);
  });

  it('rejects callbacks completed by a different session user than the one in state', async () => {
    const stateUserId = crypto.randomUUID();
    const state = signGithubInstallState({
      workspaceId: crypto.randomUUID(),
      userId: stateUserId,
    });
    const github = githubClient();

    const result = handleGithubCallback({
      github,
      code: 'code',
      installationId: 123,
      state,
      sessionUserId: crypto.randomUUID(),
      sessionMemberships: [],
      requireWorkspaceMembership: vi.fn(() => Promise.resolve()),
      getExistingGithubConnection: vi.fn(() => Promise.resolve(undefined)),
      connectGithubInstallation: vi.fn(() => {
        throw new Error('must not connect');
      }),
    });

    await expect(result).rejects.toBeInstanceOf(GithubInstallStateActorMismatchError);
    expect(github.exchangeOAuthCode).not.toHaveBeenCalled();
  });

  it('returns the existing connection without re-running OAuth on reload', async () => {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const state = signGithubInstallState({workspaceId, userId});
    const github = githubClient();
    const existing = githubConnection({workspaceId, lifecycleStatus: 'active'});
    const connectGithubInstallation = vi.fn(() => {
      throw new Error('must not reconnect');
    });

    const result = await handleGithubCallback({
      github,
      code: 'code',
      installationId: 123,
      state,
      sessionUserId: userId,
      sessionMemberships: [],
      requireWorkspaceMembership: vi.fn(() => Promise.resolve()),
      getExistingGithubConnection: vi.fn(() => Promise.resolve(existing)),
      connectGithubInstallation,
    });

    expect(result).toBe(existing);
    expect(github.exchangeOAuthCode).not.toHaveBeenCalled();
    expect(connectGithubInstallation).not.toHaveBeenCalled();
  });

  it('refuses to claim an installation already linked to another workspace', async () => {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const state = signGithubInstallState({workspaceId, userId});
    const github = githubClient();
    const existing = githubConnection({workspaceId: crypto.randomUUID()});

    const result = handleGithubCallback({
      github,
      code: 'code',
      installationId: 123,
      state,
      sessionUserId: userId,
      sessionMemberships: [],
      requireWorkspaceMembership: vi.fn(() => Promise.resolve()),
      getExistingGithubConnection: vi.fn(() => Promise.resolve(existing)),
      connectGithubInstallation: vi.fn(() => {
        throw new Error('must not connect');
      }),
    });

    await expect(result).rejects.toBeInstanceOf(GithubInstallationAlreadyLinkedError);
    expect(github.exchangeOAuthCode).not.toHaveBeenCalled();
  });

  it('re-runs the install flow when the existing connection is not active', async () => {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const state = signGithubInstallState({workspaceId, userId});
    const github = githubClient();
    const existing = githubConnection({workspaceId, lifecycleStatus: 'disabled'});
    const connectGithubInstallation = vi.fn(() =>
      Promise.resolve(githubConnection({workspaceId, lifecycleStatus: 'active'})),
    );

    const result = await handleGithubCallback({
      github,
      code: 'code',
      installationId: 123,
      state,
      sessionUserId: userId,
      sessionMemberships: [],
      requireWorkspaceMembership: vi.fn(() => Promise.resolve()),
      getExistingGithubConnection: vi.fn(() => Promise.resolve(existing)),
      connectGithubInstallation,
    });

    expect(result.lifecycleStatus).toBe('active');
    expect(github.exchangeOAuthCode).toHaveBeenCalled();
    expect(connectGithubInstallation).toHaveBeenCalled();
  });
});
