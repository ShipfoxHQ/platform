import type {GetIntegrationConnectionByIdFn} from '@shipfox/api-integration-spi';
import {GithubIntegrationProviderError} from '#core/errors.js';
import {
  GITHUB_STATEFUL_INSTALLATION_TOKEN,
  GITHUB_STATELESS_INSTALLATION_TOKEN,
  githubInstallationFactory,
} from '#test/index.js';
import {encodeInstallationTokenEnvelope} from './installation-token-envelope.js';
import {createGithubInstallationTokenProvider} from './installation-token-provider.js';

const GITHUB_INSTALLATION_TOKEN_PATTERN = /^ghs_[A-Za-z0-9._-]{36,}$/u;

const {
  appOptions,
  authMock,
  createInstallationAccessTokenMock,
  listReposAccessibleToInstallationMock,
  octokitOptionsMock,
  RequestErrorMock,
} = vi.hoisted(() => ({
  appOptions: [] as unknown[],
  authMock: vi.fn(),
  createInstallationAccessTokenMock: vi.fn(),
  listReposAccessibleToInstallationMock: vi.fn(),
  octokitOptionsMock: vi.fn(),
  RequestErrorMock: class RequestError extends Error {
    constructor(
      message: string,
      public readonly status: number,
    ) {
      super(message);
    }
  },
}));

vi.mock('octokit', () => ({
  App: class App {
    octokit = {
      auth: authMock,
      rest: {apps: {createInstallationAccessToken: createInstallationAccessTokenMock}},
    };

    constructor(options: unknown) {
      appOptions.push(options);
    }
  },
  Octokit: class Octokit {
    rest = {apps: {listReposAccessibleToInstallation: listReposAccessibleToInstallationMock}};

    constructor(options: unknown) {
      octokitOptionsMock(options);
    }

    static plugin() {
      return Octokit;
    }

    static defaults(options: unknown) {
      return {defaults: options};
    }
  },
  RequestError: RequestErrorMock,
}));

describe('GithubInstallationTokenProvider', () => {
  beforeEach(() => {
    appOptions.length = 0;
    authMock.mockReset();
    createInstallationAccessTokenMock.mockReset();
    listReposAccessibleToInstallationMock.mockReset();
    octokitOptionsMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mints a broad installation token on a cache miss', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {
        token: GITHUB_STATELESS_INSTALLATION_TOKEN,
        expires_at: '2026-06-10T12:00:00.000Z',
      },
    });
    const provider = createGithubInstallationTokenProvider();

    const result = await provider.getInstallationAccessToken(1);

    expect(result).toEqual({
      token: GITHUB_STATELESS_INSTALLATION_TOKEN,
      expiresAt: new Date('2026-06-10T12:00:00.000Z'),
    });
    expect(GITHUB_STATELESS_INSTALLATION_TOKEN).toMatch(GITHUB_INSTALLATION_TOKEN_PATTERN);
    expect(GITHUB_STATELESS_INSTALLATION_TOKEN.slice(4).split('.')).toHaveLength(3);
    expect(createInstallationAccessTokenMock).toHaveBeenCalledWith({
      installation_id: 1,
    });
  });

  it('passes through a stateful broad installation token', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {
        token: GITHUB_STATEFUL_INSTALLATION_TOKEN,
        expires_at: '2026-06-10T12:00:00.000Z',
      },
    });
    const provider = createGithubInstallationTokenProvider();

    const result = await provider.getInstallationAccessToken(1);

    expect(result.token).toBe(GITHUB_STATEFUL_INSTALLATION_TOKEN);
    expect(GITHUB_STATEFUL_INSTALLATION_TOKEN).not.toContain('.');
  });

  it('returns a cached token without a second mint', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T11:00:00.000Z'));
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {
        token: GITHUB_STATELESS_INSTALLATION_TOKEN,
        expires_at: '2026-06-10T12:00:00.000Z',
      },
    });
    const provider = createGithubInstallationTokenProvider();

    const first = await provider.getInstallationAccessToken(1);
    const second = await provider.getInstallationAccessToken(1);

    expect(first).toEqual(second);
    expect(createInstallationAccessTokenMock).toHaveBeenCalledTimes(1);
  });

  it('mints a fresh token inside the expiry refresh margin', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'));
    createInstallationAccessTokenMock
      .mockResolvedValueOnce({
        data: {token: 'ghs_first', expires_at: '2026-06-10T12:10:00.000Z'},
      })
      .mockResolvedValueOnce({
        data: {token: 'ghs_second', expires_at: '2026-06-10T13:00:00.000Z'},
      });
    const provider = createGithubInstallationTokenProvider();

    const first = await provider.getInstallationAccessToken(1);
    vi.setSystemTime(new Date('2026-06-10T12:06:00.000Z'));
    const second = await provider.getInstallationAccessToken(1);

    expect(first.token).toBe('ghs_first');
    expect(second.token).toBe('ghs_second');
    expect(createInstallationAccessTokenMock).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent cold-cache mints for one installation', async () => {
    let resolveMint: (
      value: Awaited<ReturnType<typeof createInstallationAccessTokenMock>>,
    ) => void = (_value) => {
      throw new Error('Mint promise was not initialized');
    };
    createInstallationAccessTokenMock.mockReturnValue(
      new Promise((resolve) => {
        resolveMint = resolve;
      }),
    );
    const provider = createGithubInstallationTokenProvider();

    const first = provider.getInstallationAccessToken(1);
    const second = provider.getInstallationAccessToken(1);
    resolveMint({
      data: {token: 'ghs_installationtoken', expires_at: '2026-06-10T12:00:00.000Z'},
    });
    const results = await Promise.all([first, second]);

    expect(results).toEqual([
      {token: 'ghs_installationtoken', expiresAt: new Date('2026-06-10T12:00:00.000Z')},
      {token: 'ghs_installationtoken', expiresAt: new Date('2026-06-10T12:00:00.000Z')},
    ]);
    expect(createInstallationAccessTokenMock).toHaveBeenCalledTimes(1);
  });

  it('composes the RAM tier over the shared token cache', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T11:00:00.000Z'));
    const installationId = Math.floor(Math.random() * 1_000_000_000);
    const connectionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    await githubInstallationFactory.create({installationId: String(installationId), connectionId});
    const values = new Map<string, string>();
    let lockCalls = 0;
    function withLock<T>(
      _installationId: number,
      _scopeKey: string | undefined,
      fn: () => Promise<T>,
    ) {
      lockCalls += 1;
      return fn().then((value) => ({acquired: true as const, value}));
    }
    const getIntegrationConnectionById: GetIntegrationConnectionByIdFn = () =>
      Promise.resolve({
        id: connectionId,
        workspaceId,
        provider: 'github',
        externalAccountId: String(installationId),
        slug: 'github_shipfox',
        displayName: 'GitHub shipfox',
        lifecycleStatus: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {
        token: GITHUB_STATELESS_INSTALLATION_TOKEN,
        expires_at: '2026-06-10T12:00:00.000Z',
      },
    });
    const provider = createGithubInstallationTokenProvider({
      getIntegrationConnectionById,
      secretStore: {
        read: (readWorkspaceId, readInstallationId, readScopeKey) =>
          Promise.resolve(
            values.get(tieredSecretKey(readWorkspaceId, readInstallationId, readScopeKey)) ?? null,
          ),
        write: (writeWorkspaceId, writeInstallationId, envelope, writeScopeKey) => {
          values.set(
            tieredSecretKey(writeWorkspaceId, writeInstallationId, writeScopeKey),
            encodeInstallationTokenEnvelope(envelope),
          );
          return Promise.resolve();
        },
      },
      withLock,
      now: () => new Date(),
    });

    const first = await provider.getInstallationAccessToken(installationId);
    const second = await provider.getInstallationAccessToken(installationId);

    expect(first).toEqual(second);
    expect(first.token).toBe(GITHUB_STATELESS_INSTALLATION_TOKEN);
    expect(values.get(`${workspaceId}:${installationId}`)).toContain(
      GITHUB_STATELESS_INSTALLATION_TOKEN,
    );
    expect(lockCalls).toBe(1);
    expect(createInstallationAccessTokenMock).toHaveBeenCalledTimes(1);
  });

  it('configures throttle retry handlers on the mint octokit', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {token: 'ghs_installationtoken', expires_at: '2026-06-10T12:00:00.000Z'},
    });
    const provider = createGithubInstallationTokenProvider();

    await provider.getInstallationAccessToken(1);

    expect(appOptions).toEqual([
      expect.objectContaining({
        Octokit: {
          defaults: {
            baseUrl: 'https://api.github.com',
            throttle: {
              onRateLimit: expect.any(Function),
              onSecondaryRateLimit: expect.any(Function),
            },
          },
        },
      }),
    ]);
  });

  it('maps missing installations to an installation-not-found provider error', async () => {
    createInstallationAccessTokenMock.mockRejectedValue(new RequestErrorMock('Not Found', 404));
    const provider = createGithubInstallationTokenProvider();

    const result = provider.getInstallationAccessToken(1);

    await expect(result).rejects.toMatchObject({
      reason: 'installation-not-found',
    });
  });

  it('rejects a response without a token', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {expires_at: '2026-06-10T12:00:00.000Z'},
    });
    const provider = createGithubInstallationTokenProvider();

    const result = provider.getInstallationAccessToken(1);

    await expect(result).rejects.toMatchObject({
      reason: 'malformed-provider-response',
    });
    await expect(result).rejects.toBeInstanceOf(GithubIntegrationProviderError);
  });

  it('rejects a response with a missing or unparseable expiry', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {token: 'ghs_installationtoken'},
    });
    const provider = createGithubInstallationTokenProvider();

    const result = provider.getInstallationAccessToken(1);

    await expect(result).rejects.toMatchObject({
      reason: 'malformed-provider-response',
    });
  });

  it('mints a per-repository, per-permission token when scoped', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {
        token: GITHUB_STATELESS_INSTALLATION_TOKEN,
        expires_at: '2026-06-10T12:00:00.000Z',
        permissions: {contents: 'write'},
      },
    });
    const provider = createGithubInstallationTokenProvider();

    const result = await provider.getInstallationAccessToken(1, {
      repositoryId: 456,
      permissions: {contents: 'write'},
    });

    expect(result).toEqual({
      token: GITHUB_STATELESS_INSTALLATION_TOKEN,
      expiresAt: new Date('2026-06-10T12:00:00.000Z'),
      permissions: {contents: 'write'},
    });
    expect(createInstallationAccessTokenMock).toHaveBeenCalledWith({
      installation_id: 1,
      repository_ids: [456],
      permissions: {contents: 'write'},
    });
  });

  it('keeps the broad minting shape unchanged for unscoped requests', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {token: 'ghs_installationtoken', expires_at: '2026-06-10T12:00:00.000Z'},
    });
    const provider = createGithubInstallationTokenProvider();

    await provider.getInstallationAccessToken(1);

    expect(createInstallationAccessTokenMock).toHaveBeenCalledWith({
      installation_id: 1,
    });
  });

  it('never reuses a cached token across scopes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T11:00:00.000Z'));
    createInstallationAccessTokenMock
      .mockResolvedValueOnce({
        data: {token: 'ghs_broad', expires_at: '2026-06-10T12:00:00.000Z'},
      })
      .mockResolvedValueOnce({
        data: {
          token: 'ghs_scoped_contents',
          expires_at: '2026-06-10T12:00:00.000Z',
          permissions: {contents: 'write'},
        },
      })
      .mockResolvedValueOnce({
        data: {
          token: 'ghs_scoped_issues',
          expires_at: '2026-06-10T12:00:00.000Z',
          permissions: {issues: 'write'},
        },
      });
    const provider = createGithubInstallationTokenProvider();

    const broad = await provider.getInstallationAccessToken(1);
    const scoped = await provider.getInstallationAccessToken(1, {
      repositoryId: 456,
      permissions: {contents: 'write'},
    });
    const scopedAgain = await provider.getInstallationAccessToken(1, {
      repositoryId: 456,
      permissions: {contents: 'write'},
    });
    const otherScope = await provider.getInstallationAccessToken(1, {
      repositoryId: 789,
      permissions: {contents: 'write'},
    });

    expect(broad.token).toBe('ghs_broad');
    expect(scoped.token).toBe('ghs_scoped_contents');
    expect(scopedAgain).toEqual(scoped);
    expect(otherScope.token).toBe('ghs_scoped_issues');
    expect(createInstallationAccessTokenMock).toHaveBeenCalledTimes(3);
  });

  it('keys shared-cache envelopes by scope', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T11:00:00.000Z'));
    const installationId = Math.floor(Math.random() * 1_000_000_000);
    const connectionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    await githubInstallationFactory.create({installationId: String(installationId), connectionId});
    const values = new Map<string, string>();
    let lockCalls = 0;
    function withLock<T>(
      _installationId: number,
      _scopeKey: string | undefined,
      fn: () => Promise<T>,
    ) {
      lockCalls += 1;
      return fn().then((value) => ({acquired: true as const, value}));
    }
    const getIntegrationConnectionById: GetIntegrationConnectionByIdFn = () =>
      Promise.resolve({
        id: connectionId,
        workspaceId,
        provider: 'github',
        externalAccountId: String(installationId),
        slug: 'github_shipfox',
        displayName: 'GitHub shipfox',
        lifecycleStatus: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    createInstallationAccessTokenMock
      .mockResolvedValueOnce({
        data: {token: 'ghs_broad', expires_at: '2026-06-10T12:00:00.000Z'},
      })
      .mockResolvedValueOnce({
        data: {
          token: 'ghs_scoped',
          expires_at: '2026-06-10T12:00:00.000Z',
          permissions: {contents: 'write'},
        },
      });
    const provider = createGithubInstallationTokenProvider({
      getIntegrationConnectionById,
      secretStore: {
        read: (readWorkspaceId, readInstallationId, readScopeKey) =>
          Promise.resolve(
            values.get(tieredSecretKey(readWorkspaceId, readInstallationId, readScopeKey)) ?? null,
          ),
        write: (writeWorkspaceId, writeInstallationId, envelope, writeScopeKey) => {
          values.set(
            tieredSecretKey(writeWorkspaceId, writeInstallationId, writeScopeKey),
            encodeInstallationTokenEnvelope(envelope),
          );
          return Promise.resolve();
        },
      },
      withLock,
      now: () => new Date(),
    });

    const broad = await provider.getInstallationAccessToken(installationId);
    const scoped = await provider.getInstallationAccessToken(installationId, {
      repositoryId: 456,
      permissions: {contents: 'write'},
    });

    expect(broad.token).toBe('ghs_broad');
    expect(scoped.token).toBe('ghs_scoped');
    expect(values.get(`${workspaceId}:${installationId}`)).toContain('ghs_broad');
    expect(values.get(`${workspaceId}:${installationId}/scope/456/contents-write`)).toContain(
      'ghs_scoped',
    );
    expect(lockCalls).toBe(2);
    expect(createInstallationAccessTokenMock).toHaveBeenCalledTimes(2);
  });

  describe('resolveRepositoryId', () => {
    it('resolves owner/name within the installation repositories', async () => {
      authMock.mockResolvedValue({token: 'ghs_installationtoken'});
      listReposAccessibleToInstallationMock.mockResolvedValue({
        data: {total_count: 1, repositories: [{id: 456, full_name: 'ShipfoxHQ/shipfox'}]},
      });
      const provider = createGithubInstallationTokenProvider();

      const repositoryId = await provider.resolveRepositoryId({
        installationId: 1,
        fullName: 'shipfoxhq/SHIPFOX',
      });

      expect(repositoryId).toBe(456);
      expect(authMock).toHaveBeenCalledWith({type: 'installation', installationId: 1});
      expect(octokitOptionsMock).toHaveBeenCalledWith({
        auth: 'ghs_installationtoken',
        baseUrl: 'https://api.github.com',
      });
      expect(listReposAccessibleToInstallationMock).toHaveBeenCalledWith({
        per_page: 100,
        page: 1,
      });
    });

    it('pages through the installation repositories until the repository is found', async () => {
      authMock.mockResolvedValue({token: 'ghs_installationtoken'});
      const firstPage = Array.from({length: 100}, (_, index) => ({
        id: index + 1,
        full_name: `shipfoxhq/repo-${index}`,
      }));
      listReposAccessibleToInstallationMock
        .mockResolvedValueOnce({data: {total_count: 101, repositories: firstPage}})
        .mockResolvedValueOnce({
          data: {total_count: 101, repositories: [{id: 456, full_name: 'ShipfoxHQ/shipfox'}]},
        });
      const provider = createGithubInstallationTokenProvider();

      const repositoryId = await provider.resolveRepositoryId({
        installationId: 1,
        fullName: 'shipfoxhq/shipfox',
      });

      expect(repositoryId).toBe(456);
      expect(listReposAccessibleToInstallationMock).toHaveBeenCalledTimes(2);
      expect(listReposAccessibleToInstallationMock).toHaveBeenLastCalledWith({
        per_page: 100,
        page: 2,
      });
    });

    it('resolves a repository beyond the tenth page instead of failing as access-denied', async () => {
      authMock.mockResolvedValue({token: 'ghs_installationtoken'});
      const fullPage = Array.from({length: 100}, (_, index) => ({
        id: index + 1,
        full_name: `shipfoxhq/repo-${index}`,
      }));
      for (let page = 0; page < 10; page += 1) {
        listReposAccessibleToInstallationMock.mockResolvedValueOnce({
          data: {total_count: 1001, repositories: fullPage},
        });
      }
      listReposAccessibleToInstallationMock.mockResolvedValueOnce({
        data: {total_count: 1001, repositories: [{id: 456, full_name: 'ShipfoxHQ/shipfox'}]},
      });
      const provider = createGithubInstallationTokenProvider();

      const repositoryId = await provider.resolveRepositoryId({
        installationId: 1,
        fullName: 'shipfoxhq/shipfox',
      });

      expect(repositoryId).toBe(456);
      expect(listReposAccessibleToInstallationMock).toHaveBeenCalledTimes(11);
      expect(listReposAccessibleToInstallationMock).toHaveBeenLastCalledWith({
        per_page: 100,
        page: 11,
      });
    });

    it('rejects an unresolvable repository as access-denied before any mint', async () => {
      authMock.mockResolvedValue({token: 'ghs_installationtoken'});
      listReposAccessibleToInstallationMock.mockResolvedValue({
        data: {total_count: 0, repositories: []},
      });
      const provider = createGithubInstallationTokenProvider();

      const result = provider.resolveRepositoryId({
        installationId: 1,
        fullName: 'shipfoxhq/other',
      });

      await expect(result).rejects.toMatchObject({
        reason: 'access-denied',
        message: 'GitHub repository shipfoxhq/other is not accessible to the GitHub installation',
      });
      expect(createInstallationAccessTokenMock).not.toHaveBeenCalled();
    });
  });
});

function tieredSecretKey(
  workspaceId: string,
  installationId: number,
  scopeKey: string | undefined,
): string {
  return scopeKey === undefined
    ? `${workspaceId}:${installationId}`
    : `${workspaceId}:${installationId}/scope/${scopeKey}`;
}
