import type {GithubApiClient} from '#api/client.js';
import {GithubInstallationNotAuthorizedError} from './errors.js';
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
    const connectGithubInstallation = vi.fn(() =>
      Promise.resolve({
        id: crypto.randomUUID(),
        workspaceId,
        provider: 'github',
        externalAccountId: '123',
        displayName: 'GitHub shipfox',
        lifecycleStatus: 'active',
        capabilities: ['source_control'],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    const result = await handleGithubCallback({
      github,
      code: 'code',
      installationId: 123,
      state,
      requireWorkspaceMembership,
      connectGithubInstallation,
    });

    expect(result.externalAccountId).toBe('123');
    expect(github.listUserInstallations).toHaveBeenCalledTimes(2);
    expect(requireWorkspaceMembership).toHaveBeenCalledWith({workspaceId, userId});
    expect(connectGithubInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        installationId: '123',
        displayName: 'GitHub shipfox',
      }),
    );
  });

  it('rejects spoofed installation ids', async () => {
    const state = signGithubInstallState({
      workspaceId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    });
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
      requireWorkspaceMembership: vi.fn(() => Promise.resolve()),
      connectGithubInstallation: vi.fn(() => {
        throw new Error('must not connect');
      }),
    });

    await expect(result).rejects.toBeInstanceOf(GithubInstallationNotAuthorizedError);
  });
});
