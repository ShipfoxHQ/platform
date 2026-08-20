import type {GithubApiClient} from '#api/client.js';
import {githubInstallationFactory} from '#test/index.js';
import {GithubIntegrationProviderError} from './errors.js';
import {GithubSourceControlProvider} from './source-control.js';

const VALID_COMMIT = 'a'.repeat(40);

function githubClient(overrides: Partial<GithubApiClient> = {}): GithubApiClient {
  return {
    exchangeOAuthCode: vi.fn(() => Promise.resolve('token')),
    getBotUser: vi.fn(() => Promise.resolve({id: 12_345, login: 'shipfox-test[bot]'})),
    listUserInstallations: vi.fn(() => Promise.resolve({installationIds: [], nextCursor: null})),
    getInstallation: vi.fn(() => {
      throw new Error('not used');
    }),
    listInstallationRepositories: vi.fn(() =>
      Promise.resolve({
        repositories: [
          {
            id: 42,
            ownerLogin: 'shipfox',
            name: 'platform',
            fullName: 'shipfox/platform',
            defaultBranch: 'main',
            private: true,
            visibility: 'private',
            cloneUrl: 'https://github.com/shipfox/platform.git',
            htmlUrl: 'https://github.com/shipfox/platform',
          },
        ],
        nextCursor: '2',
      }),
    ),
    getRepository: vi.fn(() =>
      Promise.resolve({
        id: 42,
        ownerLogin: 'shipfox',
        name: 'platform',
        fullName: 'shipfox/platform',
        defaultBranch: 'main',
        private: true,
        visibility: 'private',
        cloneUrl: 'https://github.com/shipfox/platform.git',
        htmlUrl: 'https://github.com/shipfox/platform',
      }),
    ),
    listRepositoryFiles: vi.fn(() =>
      Promise.resolve({
        files: [{path: '.shipfox/workflows/ci.yml', size: 64}],
        nextCursor: null,
      }),
    ),
    fetchRepositoryFile: vi.fn(() =>
      Promise.resolve({
        path: '.shipfox/workflows/ci.yml',
        content: 'name: CI\njobs:\n  build:\n    steps:\n      - run: pnpm test\n',
        size: 58,
      }),
    ),
    createInstallationAccessToken: vi.fn(() =>
      Promise.resolve({
        token: 'ghs_installationtoken',
        expiresAt: new Date('2026-06-10T12:00:00.000Z'),
      }),
    ),
    ...overrides,
  };
}

describe('GithubSourceControlProvider', () => {
  let connectionId: string;
  let installationId: number;

  beforeEach(() => {
    connectionId = crypto.randomUUID();
    installationId = Math.floor(Math.random() * 1_000_000) + 1;
  });

  async function createInstallation(): Promise<void> {
    await githubInstallationFactory.create({
      connectionId,
      installationId: String(installationId),
      latestEvent: {id: 123},
    });
  }

  function connection() {
    return {
      id: connectionId,
      workspaceId: crypto.randomUUID(),
      provider: 'github' as const,
      externalAccountId: '123',
      slug: 'github_shipfox',
      displayName: 'GitHub shipfox',
      lifecycleStatus: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  it('normalizes push trigger references', () => {
    const provider = new GithubSourceControlProvider(githubClient());

    const result = provider.resolveTriggerReference({
      ref: 'refs/heads/feature/review',
      after: VALID_COMMIT,
      repository: {id: 42},
      sender: {login: 'octocat'},
    });

    expect(result).toEqual({
      externalRepositoryId: 'github:42',
      ref: 'refs/heads/feature/review',
      commit: VALID_COMMIT,
      actor: 'octocat',
    });
  });

  it('resolves a null actor when the payload names no sender', () => {
    const provider = new GithubSourceControlProvider(githubClient());

    const result = provider.resolveTriggerReference({
      ref: 'refs/heads/main',
      after: VALID_COMMIT,
      repository: {id: 42},
    });

    expect(result).toMatchObject({actor: null});
  });

  it('normalizes pull-request trigger references from the head repository', () => {
    const provider = new GithubSourceControlProvider(githubClient());

    const result = provider.resolveTriggerReference({
      repository: {id: 42},
      sender: {login: 'octocat'},
      pull_request: {
        number: 17,
        head: {
          sha: VALID_COMMIT,
          repo: {id: 42},
        },
        base: {repo: {id: 42}},
      },
    });

    expect(result).toEqual({
      externalRepositoryId: 'github:42',
      ref: 'refs/pull/17/head',
      commit: VALID_COMMIT,
      actor: 'octocat',
    });
  });

  it.each([
    undefined,
    {},
    {ref: 'refs/heads/main', after: VALID_COMMIT},
    {ref: 'refs/heads/feature branch', after: VALID_COMMIT, repository: {id: 42}},
    {ref: 'refs/heads/feature..branch', after: VALID_COMMIT, repository: {id: 42}},
    {ref: 'refs/heads/main', after: '0'.repeat(40), repository: {id: 42}},
    {ref: 'refs/heads/main', after: 'not-a-commit', repository: {id: 42}},
    {
      repository: {id: 42},
      pull_request: {
        number: 17,
        head: {sha: VALID_COMMIT, repo: {id: 84}},
        base: {repo: {id: 42}},
      },
    },
  ])('returns null for an unresolvable or unsafe trigger payload', (payload) => {
    const provider = new GithubSourceControlProvider(githubClient());

    const result = provider.resolveTriggerReference(payload);

    expect(result).toBeNull();
  });

  it('lists repositories using installation auth metadata', async () => {
    await createInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.listRepositories({
      connection: connection(),
      limit: 50,
    });

    expect(result.repositories[0]?.externalRepositoryId).toBe('github:42');
    expect(result.repositories[0]?.visibility).toBe('private');
    expect(result.nextCursor).toBe('2');
    expect(github.listInstallationRepositories).toHaveBeenCalledWith({
      installationId,
      limit: 50,
      cursor: undefined,
    });
  });

  it('resolves repositories directly from the provider-owned repository id', async () => {
    await createInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.resolveRepository({
      connection: connection(),
      externalRepositoryId: 'github:42',
    });

    expect(result.fullName).toBe('shipfox/platform');
    expect(github.getRepository).toHaveBeenCalledWith({
      installationId,
      repositoryId: 42,
    });
    expect(github.listInstallationRepositories).not.toHaveBeenCalled();
  });

  it('rejects missing installation metadata', async () => {
    const provider = new GithubSourceControlProvider(githubClient());

    const result = provider.listRepositories({
      connection: {
        id: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        provider: 'github',
        externalAccountId: '123',
        slug: 'github_shipfox',
        displayName: 'GitHub shipfox',
        lifecycleStatus: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      limit: 50,
    });

    await expect(result).rejects.toBeInstanceOf(GithubIntegrationProviderError);
  });

  it('lists repository files using the provider-owned repository id', async () => {
    await createInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.listFiles({
      connection: connection(),
      externalRepositoryId: 'github:42',
      ref: 'main',
      prefix: '.shipfox/workflows/',
      limit: 100,
    });

    expect(result.files[0]?.path).toBe('.shipfox/workflows/ci.yml');
    expect(github.listRepositoryFiles).toHaveBeenCalledWith({
      installationId,
      repositoryId: 42,
      ref: 'main',
      prefix: '.shipfox/workflows/',
      limit: 100,
      cursor: undefined,
    });
  });

  it('fetches repository file contents using the provider-owned repository id', async () => {
    await createInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.fetchFile({
      connection: connection(),
      externalRepositoryId: 'github:42',
      ref: 'main',
      path: '.shipfox/workflows/ci.yml',
    });

    expect(result.content).toContain('name: CI');
    expect(github.fetchRepositoryFile).toHaveBeenCalledWith({
      installationId,
      repositoryId: 42,
      ref: 'main',
      path: '.shipfox/workflows/ci.yml',
    });
  });

  it.each([
    'shipfox/platform',
    'github:',
    'github:foo',
    'github:foo/bar',
    'github:42abc',
    'github:-1',
    'github:0',
    'github:42.5',
    'gitlab:42',
    '',
  ])('rejects malformed external repository id %s', async (externalRepositoryId) => {
    await createInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = provider.resolveRepository({
      connection: connection(),
      externalRepositoryId,
    });

    await expect(result).rejects.toMatchObject({reason: 'repository-not-found'});
    expect(github.getRepository).not.toHaveBeenCalled();
  });

  it('rejects oversized repository file contents', async () => {
    await createInstallation();
    const github = githubClient({
      fetchRepositoryFile: vi.fn(() =>
        Promise.resolve({
          path: '.shipfox/workflows/huge.yml',
          content: 'x'.repeat(1_000_001),
          size: 1_000_001,
        }),
      ),
    });
    const provider = new GithubSourceControlProvider(github);

    const result = provider.fetchFile({
      connection: connection(),
      externalRepositoryId: 'github:42',
      ref: 'main',
      path: '.shipfox/workflows/huge.yml',
    });

    await expect(result).rejects.toMatchObject({reason: 'content-too-large'});
  });

  it('creates a checkout spec with a clean url and short-lived credentials', async () => {
    await createInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.createCheckoutSpec({
      connection: connection(),
      externalRepositoryId: 'github:42',
      ref: 'feature/x',
      permissions: {contents: 'write'},
    });

    expect(result).toEqual({
      repositoryUrl: 'https://github.com/shipfox/platform.git',
      ref: 'feature/x',
      credentials: {
        username: 'x-access-token',
        token: 'ghs_installationtoken',
        expiresAt: new Date('2026-06-10T12:00:00.000Z'),
      },
      gitAuthor: {
        name: 'shipfox-test[bot]',
        email: '12345+shipfox-test[bot]@users.noreply.github.com',
      },
    });
    expect(result.repositoryUrl).not.toContain('ghs_installationtoken');
    expect(github.createInstallationAccessToken).toHaveBeenCalledWith({
      installationId,
      repositoryId: 42,
      permissions: {contents: 'write'},
    });
    expect(github.getBotUser).toHaveBeenCalledWith({
      username: 'shipfox-test[bot]',
      installationAccessToken: 'ghs_installationtoken',
    });
  });

  it('defaults the checkout ref to the repository default branch', async () => {
    await createInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.createCheckoutSpec({
      connection: connection(),
      externalRepositoryId: 'github:42',
    });

    expect(result.ref).toBe('main');
  });

  it('propagates provider errors raised while minting the checkout token', async () => {
    await createInstallation();
    const github = githubClient({
      createInstallationAccessToken: vi.fn(() =>
        Promise.reject(new GithubIntegrationProviderError('access-denied', 'token denied')),
      ),
    });
    const provider = new GithubSourceControlProvider(github);

    const result = provider.createCheckoutSpec({
      connection: connection(),
      externalRepositoryId: 'github:42',
    });

    await expect(result).rejects.toMatchObject({reason: 'access-denied'});
  });

  it('rejects a malformed external repository id before any api call', async () => {
    await createInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = provider.createCheckoutSpec({
      connection: connection(),
      externalRepositoryId: 'github:not-a-number',
    });

    await expect(result).rejects.toMatchObject({reason: 'repository-not-found'});
    expect(github.getRepository).not.toHaveBeenCalled();
    expect(github.createInstallationAccessToken).not.toHaveBeenCalled();
  });
});
