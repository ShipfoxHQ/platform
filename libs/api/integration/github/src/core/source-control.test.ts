import type {GithubApiClient, GithubRepository} from '#api/client.js';
import type {GithubCheckoutTokenCachePort} from '#api/github-checkout-token-cache.js';
import {githubInstallationFactory} from '#test/index.js';
import {GithubIntegrationProviderError} from './errors.js';
import {GithubSourceControlProvider} from './source-control.js';

const VALID_COMMIT = 'a'.repeat(40);
const CHECKOUT_REPOSITORY: GithubRepository = {
  id: 42,
  ownerLogin: 'shipfox',
  name: 'platform',
  fullName: 'shipfox/platform',
  defaultBranch: 'main',
  private: true,
  visibility: 'private',
  cloneUrl: 'https://github.com/shipfox/platform.git',
  htmlUrl: 'https://github.com/shipfox/platform',
};

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
    listRepositoryCommits: vi.fn(() =>
      Promise.resolve([{sha: 'a'.repeat(40)}, {sha: 'b'.repeat(40)}]),
    ),
    createInstallationAccessToken: vi.fn(() =>
      Promise.resolve({
        token: 'ghs_installationtoken',
        expiresAt: new Date('2026-06-10T12:00:00.000Z'),
        repositories: [CHECKOUT_REPOSITORY],
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

  async function createInstallation(
    overrides: {suspendedAt?: Date | null; deletedAt?: Date | null} = {},
  ): Promise<void> {
    await githubInstallationFactory.create({
      connectionId,
      installationId: String(installationId),
      latestEvent: {id: 123},
      ...overrides,
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
      repositoryAccessMode: 'selected' as const,
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
        repositoryAccessMode: 'selected',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      limit: 50,
    });

    await expect(result).rejects.toBeInstanceOf(GithubIntegrationProviderError);
  });

  it.each([
    ['suspended', {suspendedAt: new Date()}],
    ['deleted', {deletedAt: new Date()}],
  ])('rejects %s installations before provider access', async (_state, state) => {
    await createInstallation(state);
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    await expect(
      provider.listRepositories({connection: connection(), limit: 50}),
    ).rejects.toMatchObject({reason: 'access-denied'});
    expect(github.listInstallationRepositories).not.toHaveBeenCalled();
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

  it('resolves a branch ref to the commit it points at', async () => {
    await createInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.resolveRef({
      connection: connection(),
      externalRepositoryId: 'github:42',
      ref: 'refs/heads/main',
    });

    expect(result).toEqual({ref: 'refs/heads/main', commit: VALID_COMMIT});
    expect(github.listRepositoryCommits).toHaveBeenCalledWith({
      installationId,
      repositoryId: 42,
      ref: 'refs/heads/main',
    });
  });

  it('resolves a tag ref to the commit it points at', async () => {
    await createInstallation();
    const github = githubClient({
      listRepositoryCommits: vi.fn(() => Promise.resolve([{sha: 'c'.repeat(40)}])),
    });
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.resolveRef({
      connection: connection(),
      externalRepositoryId: 'github:42',
      ref: 'refs/tags/v1.0.0',
    });

    expect(result).toEqual({ref: 'refs/tags/v1.0.0', commit: 'c'.repeat(40)});
  });

  it('maps a ref with no commits to ref-not-found', async () => {
    await createInstallation();
    const github = githubClient({
      listRepositoryCommits: vi.fn(() => Promise.resolve([])),
    });
    const provider = new GithubSourceControlProvider(github);

    const result = provider.resolveRef({
      connection: connection(),
      externalRepositoryId: 'github:42',
      ref: 'refs/heads/missing',
    });

    await expect(result).rejects.toMatchObject({reason: 'ref-not-found'});
  });

  it('rejects a commit response with an invalid object id', async () => {
    await createInstallation();
    const github = githubClient({
      listRepositoryCommits: vi.fn(() => Promise.resolve([{sha: 'not-a-commit'}])),
    });
    const provider = new GithubSourceControlProvider(github);

    const result = provider.resolveRef({
      connection: connection(),
      externalRepositoryId: 'github:42',
      ref: 'refs/heads/main',
    });

    await expect(result).rejects.toMatchObject({
      reason: 'malformed-provider-response',
      message: 'GitHub ref "refs/heads/main" resolved to an invalid commit',
    });
  });

  it.each([
    'a'.repeat(40),
    'refs/pull/17/head',
    'main',
    '-evil',
  ])('rejects ref %s as ref-invalid', async (ref) => {
    await createInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = provider.resolveRef({
      connection: connection(),
      externalRepositoryId: 'github:42',
      ref,
    });

    await expect(result).rejects.toMatchObject({reason: 'ref-invalid'});
    expect(github.listRepositoryCommits).not.toHaveBeenCalled();
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
      target: {kind: 'external-id', externalRepositoryId: 'github:42'},
      credentials: {
        username: 'x-access-token',
        token: 'ghs_installationtoken',
        expiresAt: new Date('2026-06-10T12:00:00.000Z'),
        generation: expect.any(String),
        renewal: {
          mode: 'refresh-at',
          refreshAt: new Date('2026-06-10T11:55:00.000Z'),
        },
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
    expect(github.createInstallationAccessToken).toHaveBeenCalledTimes(1);
    expect(github.getRepository).not.toHaveBeenCalled();
    expect(github.listInstallationRepositories).not.toHaveBeenCalled();
    expect(github.getBotUser).toHaveBeenCalledWith({
      username: 'shipfox-test[bot]',
      installationAccessToken: 'ghs_installationtoken',
    });
  });

  it('creates a name-target checkout spec from the mint response without metadata lookups', async () => {
    await createInstallation();
    const github = githubClient({
      createInstallationAccessToken: vi.fn(() =>
        Promise.resolve({
          token: 'ghs_name_target_token',
          expiresAt: new Date('2026-06-10T12:00:00.000Z'),
          repositories: [
            {
              ...CHECKOUT_REPOSITORY,
              ownerLogin: 'ShipFox',
              name: 'Platform',
              fullName: 'ShipFox/Platform',
              defaultBranch: 'trunk',
              cloneUrl: 'https://github.com/ShipFox/Platform.git',
              htmlUrl: 'https://github.com/ShipFox/Platform',
            },
          ],
        }),
      ),
    });
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.createCheckoutSpec({
      connection: connection(),
      target: {kind: 'name', owner: 'shipfox', name: 'platform'},
      permissions: {contents: 'read'},
    });

    expect(result.repositoryUrl).toBe('https://github.com/ShipFox/Platform.git');
    expect(result.ref).toBe('trunk');
    expect(github.createInstallationAccessToken).toHaveBeenCalledWith({
      installationId,
      repositoryName: 'platform',
      permissions: {contents: 'read'},
    });
    expect(github.getRepository).not.toHaveBeenCalled();
    expect(github.listInstallationRepositories).not.toHaveBeenCalled();
  });

  it('uses a name target for credential-only delivery without metadata lookups', async () => {
    await createInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    await expect(
      provider.createCheckoutCredentials({
        connection: connection(),
        target: {kind: 'name', owner: 'SHIPFOX', name: 'PLATFORM'},
        permissions: {contents: 'read'},
      }),
    ).resolves.toMatchObject({token: 'ghs_installationtoken'});

    expect(github.createInstallationAccessToken).toHaveBeenCalledWith({
      installationId,
      repositoryName: 'PLATFORM',
      permissions: {contents: 'read'},
    });
    expect(github.getRepository).not.toHaveBeenCalled();
    expect(github.listInstallationRepositories).not.toHaveBeenCalled();
  });

  it('rejects a name target when the mint response has the same name under another owner', async () => {
    await createInstallation();
    const github = githubClient({
      createInstallationAccessToken: vi.fn(() =>
        Promise.resolve({
          token: 'ghs_mismatched_owner_token',
          expiresAt: new Date('2026-06-10T12:00:00.000Z'),
          repositories: [{...CHECKOUT_REPOSITORY, ownerLogin: 'another-owner'}],
        }),
      ),
    });
    const provider = new GithubSourceControlProvider(github);

    await expect(
      provider.createCheckoutSpec({
        connection: connection(),
        target: {kind: 'name', owner: 'shipfox', name: 'platform'},
      }),
    ).rejects.toMatchObject({
      reason: 'provider-rejected',
      message: 'GitHub checkout token response does not match the requested repository',
    });
  });

  it.each([
    ['an empty response', []],
    [
      'a response with multiple repositories',
      [CHECKOUT_REPOSITORY, {...CHECKOUT_REPOSITORY, id: 84}],
    ],
    ['an id response for another repository', [{...CHECKOUT_REPOSITORY, id: 84}]],
  ])('rejects %s instead of returning its token', async (_label, repositories) => {
    await createInstallation();
    const github = githubClient({
      createInstallationAccessToken: vi.fn(() =>
        Promise.resolve({
          token: 'ghs_rejected_checkout_token',
          expiresAt: new Date('2026-06-10T12:00:00.000Z'),
          repositories,
        }),
      ),
    });
    const provider = new GithubSourceControlProvider(github);

    await expect(
      provider.createCheckoutCredentials({
        connection: connection(),
        externalRepositoryId: 'github:42',
        permissions: {contents: 'read'},
      }),
    ).rejects.toMatchObject({reason: 'provider-rejected'});
  });

  it('creates credential-only delivery without repository or bot metadata lookups', async () => {
    await createInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.createCheckoutCredentials({
      connection: connection(),
      externalRepositoryId: 'github:42',
      permissions: {contents: 'write'},
    });

    expect(result).toMatchObject({
      username: 'x-access-token',
      token: 'ghs_installationtoken',
      expiresAt: new Date('2026-06-10T12:00:00.000Z'),
      generation: expect.any(String),
      renewal: {
        mode: 'refresh-at',
        refreshAt: new Date('2026-06-10T11:55:00.000Z'),
      },
    });
    expect(github.createInstallationAccessToken).toHaveBeenCalledWith({
      installationId,
      repositoryId: 42,
      permissions: {contents: 'write'},
    });
    expect(github.getRepository).not.toHaveBeenCalled();
    expect(github.getBotUser).not.toHaveBeenCalled();
  });

  it('uses the injected exact-scope checkout cache without broad installation cache access', async () => {
    await createInstallation();
    const github = githubClient();
    const getOrMint = vi.fn<GithubCheckoutTokenCachePort['getOrMint']>(() =>
      Promise.resolve({
        token: 'cached-checkout-token',
        expiresAt: new Date('2026-06-10T12:00:00.000Z'),
        generation: 'cached-generation',
        stale: true,
      }),
    );
    const checkoutTokenCache = {getOrMint};
    const provider = new GithubSourceControlProvider(github, undefined, checkoutTokenCache);

    const result = await provider.createCheckoutCredentials({
      connection: connection(),
      externalRepositoryId: 'github:42',
      permissions: {contents: 'read'},
      rejectedGeneration: 'rejected-generation',
    });

    expect(result.token).toBe('cached-checkout-token');
    expect(result.generation).toBe('cached-generation');
    expect(result.renewal).toEqual({mode: 'on-rejection'});
    expect(github.createInstallationAccessToken).not.toHaveBeenCalled();
    const mint = checkoutTokenCache.getOrMint.mock.calls[0]?.[1];
    expect(mint).toEqual(expect.any(Function));
    await mint?.();
    expect(github.createInstallationAccessToken).toHaveBeenCalledWith({
      installationId,
      repositoryId: 42,
      permissions: {contents: 'read'},
    });
    expect(checkoutTokenCache.getOrMint).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: expect.any(String),
        installationId,
        repositoryId: 42,
        permissions: {contents: 'read'},
      }),
      expect.any(Function),
      'rejected-generation',
    );
  });

  it('does not return a rejected generation', async () => {
    await createInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.createCheckoutCredentials({
      connection: connection(),
      externalRepositoryId: 'github:42',
      permissions: {contents: 'read'},
      rejectedGeneration: 'rejected-generation',
    });

    expect(result.generation).not.toBe('rejected-generation');
  });

  it('propagates bot identity resolution failures for write checkouts', async () => {
    await createInstallation();
    const github = githubClient({
      getBotUser: vi.fn(() =>
        Promise.reject(
          new GithubIntegrationProviderError('provider-rejected', 'bot user not found'),
        ),
      ),
    });
    const provider = new GithubSourceControlProvider(github);

    const result = provider.createCheckoutSpec({
      connection: connection(),
      externalRepositoryId: 'github:42',
      permissions: {contents: 'write'},
    });

    await expect(result).rejects.toMatchObject({reason: 'provider-rejected'});
  });

  it('propagates unexpected bot lookup errors', async () => {
    await createInstallation();
    const github = githubClient({
      getBotUser: vi.fn(() => Promise.reject(new Error('unexpected lookup failure'))),
    });
    const provider = new GithubSourceControlProvider(github);

    const result = provider.createCheckoutSpec({
      connection: connection(),
      externalRepositoryId: 'github:42',
      permissions: {contents: 'write'},
    });

    await expect(result).rejects.toThrow('unexpected lookup failure');
  });

  it('rejects write checkout when the bot identity resolver is unavailable', async () => {
    await createInstallation();
    const github = githubClient();
    delete github.getBotUser;
    const provider = new GithubSourceControlProvider(github);

    const result = provider.createCheckoutSpec({
      connection: connection(),
      externalRepositoryId: 'github:42',
      permissions: {contents: 'write'},
    });

    await expect(result).rejects.toMatchObject({reason: 'provider-unavailable'});
  });

  it('omits the author and bot lookup for read-only checkouts', async () => {
    await createInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.createCheckoutSpec({
      connection: connection(),
      externalRepositoryId: 'github:42',
      permissions: {contents: 'read'},
    });

    expect(result.gitAuthor).toBeUndefined();
    expect(github.getBotUser).not.toHaveBeenCalled();
  });

  it('omits the author and bot lookup when the App username is unset', async () => {
    await createInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github, () => undefined);

    const result = await provider.createCheckoutSpec({
      connection: connection(),
      externalRepositoryId: 'github:42',
      permissions: {contents: 'write'},
    });

    expect(result.gitAuthor).toBeUndefined();
    expect(github.getBotUser).not.toHaveBeenCalled();
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
