import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {GiteaApiClient, GiteaRepository} from '#api/client.js';
import {GiteaIntegrationProviderError} from './errors.js';
import {GiteaSourceControlProvider} from './source-control.js';

const VALID_COMMIT = 'a'.repeat(40);

const REPOSITORY: GiteaRepository = {
  ownerLogin: 'shipfox',
  name: 'platform',
  fullName: 'shipfox/platform',
  defaultBranch: 'main',
  private: true,
  cloneUrl: 'https://gitea.example.com/shipfox/platform.git',
  htmlUrl: 'https://gitea.example.com/shipfox/platform',
};

function giteaClient(overrides: Partial<GiteaApiClient> = {}): GiteaApiClient {
  return {
    listOrgRepositories: vi.fn(() =>
      Promise.resolve({repositories: [REPOSITORY], nextCursor: '2'}),
    ),
    getRepository: vi.fn(() => Promise.resolve(REPOSITORY)),
    resolveRef: vi.fn(() => Promise.resolve('abc123')),
    listTree: vi.fn(() =>
      Promise.resolve({
        blobs: [{path: '.shipfox/workflows/ci.yml', size: 64}],
        truncated: false,
      }),
    ),
    fetchFileContent: vi.fn(() =>
      Promise.resolve({
        path: '.shipfox/workflows/ci.yml',
        content: 'name: CI\njobs:\n  build:\n    steps:\n      - run: pnpm test\n',
        size: 58,
      }),
    ),
    getBranch: vi.fn(() => Promise.resolve({commitSha: 'branch-head'})),
    getIssue: vi.fn(),
    createIssueComment: vi.fn(),
    getTag: vi.fn(() => Promise.reject(new Error('not used'))),
    organizationExists: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

function connection(): IntegrationConnection<'gitea'> {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provider: 'gitea',
    externalAccountId: 'shipfox',
    slug: 'gitea_shipfox',
    displayName: 'Gitea shipfox',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('GiteaSourceControlProvider', () => {
  it('normalizes push trigger references', () => {
    const provider = new GiteaSourceControlProvider(giteaClient());

    const result = provider.resolveTriggerReference({
      ref: 'refs/heads/feature/review',
      after: VALID_COMMIT,
      repository: {full_name: 'shipfox/platform'},
      sender: {login: 'noe'},
    });

    expect(result).toEqual({
      externalRepositoryId: 'gitea:shipfox/platform',
      ref: 'refs/heads/feature/review',
      commit: VALID_COMMIT,
      actor: 'noe',
    });
  });

  it('falls back to the sender username when no login is present', () => {
    const provider = new GiteaSourceControlProvider(giteaClient());

    const result = provider.resolveTriggerReference({
      ref: 'refs/heads/main',
      after: VALID_COMMIT,
      repository: {full_name: 'shipfox/platform'},
      sender: {username: 'noe'},
    });

    expect(result).toMatchObject({actor: 'noe'});
  });

  it('resolves a null actor when the payload names no sender', () => {
    const provider = new GiteaSourceControlProvider(giteaClient());

    const result = provider.resolveTriggerReference({
      ref: 'refs/heads/main',
      after: VALID_COMMIT,
      repository: {full_name: 'shipfox/platform'},
    });

    expect(result).toMatchObject({actor: null});
  });

  it('normalizes pull-request trigger references from the head repository', () => {
    const provider = new GiteaSourceControlProvider(giteaClient());

    const result = provider.resolveTriggerReference({
      repository: {full_name: 'shipfox/platform'},
      sender: {login: 'noe'},
      pull_request: {
        number: 17,
        head: {
          sha: VALID_COMMIT,
          repo: {full_name: 'shipfox/platform'},
        },
        base: {repo: {full_name: 'shipfox/platform'}},
      },
    });

    expect(result).toEqual({
      externalRepositoryId: 'gitea:shipfox/platform',
      ref: 'refs/pull/17/head',
      commit: VALID_COMMIT,
      actor: 'noe',
    });
  });

  it.each([
    undefined,
    {},
    {ref: 'refs/heads/main', after: VALID_COMMIT},
    {
      ref: 'refs/heads/feature branch',
      after: VALID_COMMIT,
      repository: {full_name: 'shipfox/platform'},
    },
    {
      ref: 'refs/heads/feature..branch',
      after: VALID_COMMIT,
      repository: {full_name: 'shipfox/platform'},
    },
    {
      ref: 'refs/heads/main',
      after: '0'.repeat(40),
      repository: {full_name: 'shipfox/platform'},
    },
    {
      ref: 'refs/heads/main',
      after: 'not-a-commit',
      repository: {full_name: 'shipfox/platform'},
    },
    {ref: 'refs/heads/main', after: VALID_COMMIT, repository: {full_name: 'shipfox'}},
    {
      ref: 'refs/heads/main',
      after: VALID_COMMIT,
      repository: {full_name: 'shipfox/platform/extra'},
    },
    {
      repository: {full_name: 'shipfox/platform'},
      pull_request: {
        number: 17,
        head: {sha: VALID_COMMIT, repo: {full_name: 'fork/platform'}},
        base: {repo: {full_name: 'shipfox/platform'}},
      },
    },
  ])('returns null for an unresolvable or unsafe trigger payload', (payload) => {
    const provider = new GiteaSourceControlProvider(giteaClient());

    const result = provider.resolveTriggerReference(payload);

    expect(result).toBeNull();
  });

  it('resolves a branch ref to the commit it points at', async () => {
    const gitea = giteaClient();
    const provider = new GiteaSourceControlProvider(gitea);

    const result = await provider.resolveRef({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
      ref: 'refs/heads/main',
    });

    expect(result).toEqual({ref: 'refs/heads/main', commit: 'branch-head'});
    expect(gitea.getBranch).toHaveBeenCalledWith({
      owner: 'shipfox',
      repo: 'platform',
      branch: 'main',
    });
    expect(gitea.getTag).not.toHaveBeenCalled();
  });

  it('does not cross namespaces for a missing namespaced branch ref', async () => {
    const gitea = giteaClient({
      getBranch: vi.fn(() =>
        Promise.reject(new GiteaIntegrationProviderError('ref-not-found', 'no branch')),
      ),
      getTag: vi.fn(() => Promise.resolve({commitSha: VALID_COMMIT})),
    });
    const provider = new GiteaSourceControlProvider(gitea);

    const result = provider.resolveRef({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
      ref: 'refs/heads/release',
    });

    await expect(result).rejects.toMatchObject({reason: 'ref-not-found'});
    expect(gitea.getBranch).toHaveBeenCalledWith({
      owner: 'shipfox',
      repo: 'platform',
      branch: 'release',
    });
    expect(gitea.getTag).not.toHaveBeenCalled();
  });

  it('uses the tag endpoint first for a tag ref', async () => {
    const gitea = giteaClient({
      getTag: vi.fn(() => Promise.resolve({commitSha: VALID_COMMIT})),
    });
    const provider = new GiteaSourceControlProvider(gitea);

    const result = await provider.resolveRef({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
      ref: 'refs/tags/v1.0.0',
    });

    expect(result).toEqual({ref: 'refs/tags/v1.0.0', commit: VALID_COMMIT});
    expect(gitea.getTag).toHaveBeenCalledWith({
      owner: 'shipfox',
      repo: 'platform',
      tag: 'v1.0.0',
    });
    expect(gitea.getBranch).not.toHaveBeenCalled();
  });

  it('maps a ref that is neither branch nor tag to ref-not-found', async () => {
    const gitea = giteaClient({
      getBranch: vi.fn(() =>
        Promise.reject(new GiteaIntegrationProviderError('ref-not-found', 'no branch')),
      ),
      getTag: vi.fn(() =>
        Promise.reject(new GiteaIntegrationProviderError('ref-not-found', 'no tag')),
      ),
    });
    const provider = new GiteaSourceControlProvider(gitea);

    const result = provider.resolveRef({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
      ref: 'feature/missing',
    });

    await expect(result).rejects.toMatchObject({reason: 'ref-not-found'});
  });

  it('falls back to a tag for an unnamespaced ref', async () => {
    const gitea = giteaClient({
      getBranch: vi.fn(() =>
        Promise.reject(new GiteaIntegrationProviderError('ref-not-found', 'no branch')),
      ),
      getTag: vi.fn(() => Promise.resolve({commitSha: VALID_COMMIT})),
    });
    const provider = new GiteaSourceControlProvider(gitea);

    const result = await provider.resolveRef({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
      ref: 'feature/release',
    });

    expect(result).toEqual({ref: 'feature/release', commit: VALID_COMMIT});
    expect(gitea.getBranch).toHaveBeenCalledWith({
      owner: 'shipfox',
      repo: 'platform',
      branch: 'feature/release',
    });
    expect(gitea.getTag).toHaveBeenCalledWith({
      owner: 'shipfox',
      repo: 'platform',
      tag: 'feature/release',
    });
    expect(gitea.getRepository).not.toHaveBeenCalled();
  });

  it('preserves repository-not-found when the repository is missing', async () => {
    const gitea = giteaClient({
      getBranch: vi.fn(() =>
        Promise.reject(new GiteaIntegrationProviderError('ref-not-found', 'no branch')),
      ),
      getRepository: vi.fn(() =>
        Promise.reject(new GiteaIntegrationProviderError('repository-not-found', 'no repo')),
      ),
    });
    const provider = new GiteaSourceControlProvider(gitea);

    const result = provider.resolveRef({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
      ref: 'refs/heads/main',
    });

    await expect(result).rejects.toMatchObject({reason: 'repository-not-found'});
    expect(gitea.getTag).not.toHaveBeenCalled();
  });

  it.each([
    'a'.repeat(40),
    'refs/pull/17/head',
    'main',
    '-evil',
  ])('rejects ref %s as ref-invalid', async (ref) => {
    const gitea = giteaClient();
    const provider = new GiteaSourceControlProvider(gitea);

    const result = provider.resolveRef({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
      ref,
    });

    await expect(result).rejects.toMatchObject({reason: 'ref-invalid'});
    expect(gitea.getBranch).not.toHaveBeenCalled();
    expect(gitea.getTag).not.toHaveBeenCalled();
  });

  it('propagates non-not-found branch failures without a tag fallback', async () => {
    const gitea = giteaClient({
      getBranch: vi.fn(() =>
        Promise.reject(new GiteaIntegrationProviderError('access-denied', 'denied')),
      ),
    });
    const provider = new GiteaSourceControlProvider(gitea);

    const result = provider.resolveRef({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
      ref: 'refs/heads/main',
    });

    await expect(result).rejects.toMatchObject({reason: 'access-denied'});
    expect(gitea.getTag).not.toHaveBeenCalled();
  });

  it('lists org repositories scoped to the connection account', async () => {
    const gitea = giteaClient();
    const provider = new GiteaSourceControlProvider(gitea);

    const result = await provider.listRepositories({connection: connection(), limit: 50});

    expect(result.repositories[0]?.externalRepositoryId).toBe('gitea:shipfox/platform');
    expect(result.repositories[0]?.visibility).toBe('private');
    expect(result.nextCursor).toBe('2');
    expect(gitea.listOrgRepositories).toHaveBeenCalledWith({
      org: 'shipfox',
      limit: 50,
      cursor: undefined,
    });
  });

  it('filters repositories by search across scanned pages', async () => {
    const gitea = giteaClient({
      listOrgRepositories: vi.fn(() =>
        Promise.resolve({
          repositories: [REPOSITORY, {...REPOSITORY, name: 'docs', fullName: 'shipfox/docs'}],
          nextCursor: null,
        }),
      ),
    });
    const provider = new GiteaSourceControlProvider(gitea);

    const result = await provider.listRepositories({
      connection: connection(),
      limit: 50,
      search: 'docs',
    });

    expect(result.repositories.map((repo) => repo.fullName)).toEqual(['shipfox/docs']);
  });

  it('resolves a repository from the provider-owned id', async () => {
    const gitea = giteaClient();
    const provider = new GiteaSourceControlProvider(gitea);

    const result = await provider.resolveRepository({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
    });

    expect(result.fullName).toBe('shipfox/platform');
    expect(gitea.getRepository).toHaveBeenCalledWith({owner: 'shipfox', repo: 'platform'});
  });

  it('lists files under a prefix from the recursive tree', async () => {
    const gitea = giteaClient({
      listTree: vi.fn(() =>
        Promise.resolve({
          blobs: [
            {path: 'README.md', size: 10},
            {path: '.shipfox/workflows/ci.yml', size: 64},
            {path: '.shipfox/workflows/release.yml', size: 80},
          ],
          truncated: false,
        }),
      ),
    });
    const provider = new GiteaSourceControlProvider(gitea);

    const result = await provider.listFiles({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
      ref: 'main',
      prefix: '.shipfox/workflows/',
      limit: 100,
    });

    expect(result.files.map((file) => file.path)).toEqual([
      '.shipfox/workflows/ci.yml',
      '.shipfox/workflows/release.yml',
    ]);
    expect(result.files[0]).toEqual({path: '.shipfox/workflows/ci.yml', type: 'file', size: 64});
    expect(gitea.resolveRef).toHaveBeenCalledWith({
      owner: 'shipfox',
      repo: 'platform',
      ref: 'main',
    });
    expect(gitea.listTree).toHaveBeenCalledWith({
      owner: 'shipfox',
      repo: 'platform',
      sha: 'abc123',
    });
  });

  it('paginates files with an offset cursor', async () => {
    const gitea = giteaClient({
      listTree: vi.fn(() =>
        Promise.resolve({
          blobs: [
            {path: 'a.txt', size: 1},
            {path: 'b.txt', size: 1},
            {path: 'c.txt', size: 1},
          ],
          truncated: false,
        }),
      ),
    });
    const provider = new GiteaSourceControlProvider(gitea);

    const firstPage = await provider.listFiles({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
      ref: 'main',
      prefix: '',
      limit: 2,
    });

    expect(firstPage.files.map((file) => file.path)).toEqual(['a.txt', 'b.txt']);
    expect(firstPage.nextCursor).toBe('2');

    const secondPage = await provider.listFiles({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
      ref: 'main',
      prefix: '',
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(secondPage.files.map((file) => file.path)).toEqual(['c.txt']);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('rejects listing files when the tree is truncated', async () => {
    const gitea = giteaClient({
      listTree: vi.fn(() => Promise.resolve({blobs: [], truncated: true})),
    });
    const provider = new GiteaSourceControlProvider(gitea);

    const result = provider.listFiles({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
      ref: 'main',
      prefix: '',
      limit: 100,
    });

    await expect(result).rejects.toMatchObject({reason: 'too-many-files'});
  });

  it('fetches file content from the provider-owned id', async () => {
    const gitea = giteaClient();
    const provider = new GiteaSourceControlProvider(gitea);

    const result = await provider.fetchFile({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
      ref: 'main',
      path: '.shipfox/workflows/ci.yml',
    });

    expect(result.content).toContain('name: CI');
    expect(result.ref).toBe('main');
    expect(gitea.fetchFileContent).toHaveBeenCalledWith({
      owner: 'shipfox',
      repo: 'platform',
      path: '.shipfox/workflows/ci.yml',
      ref: 'main',
    });
  });

  it('rejects oversized file content', async () => {
    const gitea = giteaClient({
      fetchFileContent: vi.fn(() =>
        Promise.resolve({path: 'big.bin', content: 'x'.repeat(1_000_001), size: 1_000_001}),
      ),
    });
    const provider = new GiteaSourceControlProvider(gitea);

    const result = provider.fetchFile({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
      ref: 'main',
      path: 'big.bin',
    });

    await expect(result).rejects.toMatchObject({reason: 'content-too-large'});
  });

  it.each([
    'shipfox/platform',
    'gitea:',
    'gitea:platform',
    'gitea:shipfox/',
    'gitea:/platform',
    'gitea:shipfox/platform/extra',
    'gitea:shipfox/.',
    'gitea:shipfox/..',
    'github:shipfox/platform',
    '',
  ])('rejects the malformed external repository id %s before any api call', async (id) => {
    const gitea = giteaClient();
    const provider = new GiteaSourceControlProvider(gitea);

    const result = provider.resolveRepository({connection: connection(), externalRepositoryId: id});

    await expect(result).rejects.toMatchObject({reason: 'repository-not-found'});
    expect(gitea.getRepository).not.toHaveBeenCalled();
  });

  it('rejects an external repository id outside the connection account before any api call', async () => {
    const gitea = giteaClient();
    const provider = new GiteaSourceControlProvider(gitea);

    const result = provider.resolveRepository({
      connection: connection(),
      externalRepositoryId: 'gitea:intruder/platform',
    });

    await expect(result).rejects.toMatchObject({reason: 'repository-not-found'});
    expect(gitea.getRepository).not.toHaveBeenCalled();
  });

  it('creates a credential-free checkout spec carrying the service credentials', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T00:00:00.000Z'));
    try {
      const gitea = giteaClient();
      const provider = new GiteaSourceControlProvider(gitea);

      const result = await provider.createCheckoutSpec({
        connection: connection(),
        externalRepositoryId: 'gitea:shipfox/platform',
        ref: 'feature/x',
      });

      expect(result).toEqual({
        repositoryUrl: 'https://gitea.example.com/shipfox/platform.git',
        ref: 'feature/x',
        credentials: {
          username: 'shipfox-bot',
          token: 'test-service-token',
          expiresAt: new Date('2026-06-20T00:05:00.000Z'),
          generation: expect.any(String),
          renewal: {mode: 'on-rejection'},
        },
      });
      const url = new URL(result.repositoryUrl);
      expect(url.username).toBe('');
      expect(url.password).toBe('');
      expect(result.repositoryUrl).not.toContain('test-service-token');
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates a checkout spec from a name target in the connection account', async () => {
    const gitea = giteaClient();
    const provider = new GiteaSourceControlProvider(gitea);

    const result = await provider.createCheckoutSpec({
      connection: connection(),
      target: {kind: 'name', owner: 'shipfox', name: 'platform'},
      ref: 'feature/x',
    });

    expect(result.repositoryUrl).toBe('https://gitea.example.com/shipfox/platform.git');
    expect(result.ref).toBe('feature/x');
    expect(gitea.getRepository).toHaveBeenCalledWith({owner: 'shipfox', repo: 'platform'});
  });

  it('creates credential-only delivery from a name target in the connection account', async () => {
    const gitea = giteaClient();
    const provider = new GiteaSourceControlProvider(gitea);

    await expect(
      provider.createCheckoutCredentials({
        connection: connection(),
        target: {kind: 'name', owner: 'shipfox', name: 'platform'},
        permissions: {contents: 'read'},
      }),
    ).resolves.toMatchObject({username: 'shipfox-bot', token: 'test-service-token'});
    expect(gitea.getRepository).not.toHaveBeenCalled();
  });

  it('rejects a name target outside the connection account before any api call', async () => {
    const gitea = giteaClient();
    const provider = new GiteaSourceControlProvider(gitea);

    await expect(
      provider.createCheckoutCredentials({
        connection: connection(),
        target: {kind: 'name', owner: 'intruder', name: 'platform'},
        permissions: {contents: 'read'},
      }),
    ).rejects.toMatchObject({reason: 'repository-not-found'});
    expect(gitea.getRepository).not.toHaveBeenCalled();
  });

  it.each([
    '.',
    '..',
  ])('rejects dot-segment repository name %s before any api call', async (name) => {
    const gitea = giteaClient();
    const provider = new GiteaSourceControlProvider(gitea);

    await expect(
      provider.createCheckoutSpec({
        connection: connection(),
        target: {kind: 'name', owner: 'shipfox', name},
      }),
    ).rejects.toMatchObject({reason: 'repository-not-found'});
    expect(gitea.getRepository).not.toHaveBeenCalled();
  });

  it.each([
    '.',
    '..',
  ])('rejects dot-segment repository name %s in a legacy external id before any api call', async (name) => {
    const gitea = giteaClient();
    const provider = new GiteaSourceControlProvider(gitea);

    await expect(
      provider.createCheckoutSpec({
        connection: connection(),
        externalRepositoryId: `gitea:shipfox/${name}`,
      }),
    ).rejects.toMatchObject({reason: 'repository-not-found'});
    expect(gitea.getRepository).not.toHaveBeenCalled();
  });

  it('rejects credential-only delivery outside the connection account before returning credentials', async () => {
    const gitea = giteaClient();
    const provider = new GiteaSourceControlProvider(gitea);

    const result = provider.createCheckoutCredentials({
      connection: connection(),
      externalRepositoryId: 'gitea:intruder/platform',
      permissions: {contents: 'read'},
    });

    await expect(result).rejects.toMatchObject({reason: 'repository-not-found'});
    expect(gitea.getRepository).not.toHaveBeenCalled();
  });

  it('creates credential-only delivery without repository metadata lookup', async () => {
    const gitea = giteaClient();
    const provider = new GiteaSourceControlProvider(gitea);

    const result = await provider.createCheckoutCredentials({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
      permissions: {contents: 'read'},
    });

    expect(result).toMatchObject({
      username: 'shipfox-bot',
      token: 'test-service-token',
      generation: expect.any(String),
      renewal: {mode: 'on-rejection'},
    });
    expect(gitea.getRepository).not.toHaveBeenCalled();
  });

  it('returns a fresh generation and does not echo a rejected generation', async () => {
    const provider = new GiteaSourceControlProvider(giteaClient());

    const first = await provider.createCheckoutCredentials({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
      permissions: {contents: 'read'},
    });
    const second = await provider.createCheckoutCredentials({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
      permissions: {contents: 'read'},
      rejectedGeneration: first.generation,
    });

    expect(second.token).toBe(first.token);
    expect(second.generation).not.toBe(first.generation);
    expect(second.renewal).toEqual({mode: 'on-rejection'});
  });

  it('defaults the checkout ref to the repository default branch', async () => {
    const gitea = giteaClient();
    const provider = new GiteaSourceControlProvider(gitea);

    const result = await provider.createCheckoutSpec({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
    });

    expect(result.ref).toBe('main');
  });

  it('builds the checkout url from the provider clone url, not the configured base url', async () => {
    const gitea = giteaClient({
      getRepository: vi.fn(() =>
        Promise.resolve({
          ...REPOSITORY,
          cloneUrl: 'https://git.internal.example/shipfox/platform.git',
        }),
      ),
    });
    const provider = new GiteaSourceControlProvider(gitea);

    const result = await provider.createCheckoutSpec({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
    });

    expect(result.repositoryUrl).toBe('https://git.internal.example/shipfox/platform.git');
  });

  it('propagates provider errors raised while reading the repository', async () => {
    const gitea = giteaClient({
      getRepository: vi.fn(() =>
        Promise.reject(new GiteaIntegrationProviderError('access-denied', 'denied')),
      ),
    });
    const provider = new GiteaSourceControlProvider(gitea);

    const result = provider.createCheckoutSpec({
      connection: connection(),
      externalRepositoryId: 'gitea:shipfox/platform',
    });

    await expect(result).rejects.toMatchObject({reason: 'access-denied'});
  });
});
