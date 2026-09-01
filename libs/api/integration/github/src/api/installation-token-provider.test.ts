import type {GetIntegrationConnectionByIdFn} from '@shipfox/api-integration-spi';
import {GithubIntegrationProviderError} from '#core/errors.js';
import {
  GITHUB_STATEFUL_INSTALLATION_TOKEN,
  GITHUB_STATELESS_INSTALLATION_TOKEN,
  githubInstallationFactory,
} from '#test/index.js';
import {
  encodeInstallationTokenEnvelope,
  GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
  githubInstallationTokenKey,
  githubInstallationTokenPermissionFingerprint,
} from './installation-token-envelope.js';
import {createGithubInstallationTokenProvider} from './installation-token-provider.js';

const GITHUB_INSTALLATION_TOKEN_PATTERN = /^ghs_[A-Za-z0-9._-]{36,}$/u;

const {appOptions, createInstallationAccessTokenMock, RequestErrorMock} = vi.hoisted(() => ({
  appOptions: [] as unknown[],
  createInstallationAccessTokenMock: vi.fn(),
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
      rest: {apps: {createInstallationAccessToken: createInstallationAccessTokenMock}},
    };

    constructor(options: unknown) {
      appOptions.push(options);
    }
  },
  Octokit: {
    plugin() {
      return this;
    },
    defaults(options: unknown) {
      return {defaults: options};
    },
  },
  RequestError: RequestErrorMock,
}));

describe('GithubInstallationTokenProvider', () => {
  beforeEach(() => {
    appOptions.length = 0;
    createInstallationAccessTokenMock.mockReset();
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

  it('mints an installation token with the requested permission profile', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T11:00:00.000Z'));
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {
        token: GITHUB_STATELESS_INSTALLATION_TOKEN,
        expires_at: '2026-06-10T12:00:00.000Z',
      },
    });
    const provider = createGithubInstallationTokenProvider();
    const permissions = {pull_requests: 'read' as const, contents: 'write' as const};

    await provider.getInstallationAccessToken(1, undefined, permissions);
    await provider.getInstallationAccessToken(1, undefined, {
      contents: 'write',
      pull_requests: 'read',
    });

    expect(createInstallationAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(createInstallationAccessTokenMock).toHaveBeenCalledWith({
      installation_id: 1,
      permissions,
    });
    expect(githubInstallationTokenPermissionFingerprint(permissions)).toBe(
      '{"contents":"write","pull_requests":"read"}',
    );
  });

  it('uses byte-stable ordering for permission fingerprints', () => {
    expect(githubInstallationTokenPermissionFingerprint({é: 'read', z: 'read', a: 'write'})).toBe(
      '{"a":"write","z":"read","é":"read"}',
    );
  });

  it('rejects a permission profile whose explicit fingerprint does not match', async () => {
    const provider = createGithubInstallationTokenProvider();

    await expect(
      provider.getInstallationAccessToken(1, 'wrong', {contents: 'read'}),
    ).rejects.toThrow('permission fingerprint does not match permissions');
    expect(createInstallationAccessTokenMock).not.toHaveBeenCalled();
  });

  it('keeps the compatibility and permissions-derived cache profiles separate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T11:00:00.000Z'));
    createInstallationAccessTokenMock
      .mockResolvedValueOnce({
        data: {
          token: 'ghs_broad',
          expires_at: '2026-06-10T12:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        data: {
          token: 'ghs_narrow',
          expires_at: '2026-06-10T12:00:00.000Z',
        },
      });
    const provider = createGithubInstallationTokenProvider();
    const permissions = {contents: 'read' as const};

    const broad = await provider.getInstallationAccessToken(1);
    const narrow = await provider.getInstallationAccessToken(1, undefined, permissions);
    const narrowAgain = await provider.getInstallationAccessToken(1, undefined, permissions);

    expect(broad.token).toBe('ghs_broad');
    expect(narrow.token).toBe('ghs_narrow');
    expect(narrowAgain.token).toBe('ghs_narrow');
    expect(createInstallationAccessTokenMock).toHaveBeenCalledTimes(2);
    expect(createInstallationAccessTokenMock).toHaveBeenNthCalledWith(1, {
      installation_id: 1,
    });
    expect(createInstallationAccessTokenMock).toHaveBeenNthCalledWith(2, {
      installation_id: 1,
      permissions,
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

  it.each([
    ['suspended', {suspendedAt: new Date()}],
    ['deleted', {deletedAt: new Date()}],
  ])('fails closed for %s installations before reading the cache', async (_state, state) => {
    const installationId = Math.floor(Math.random() * 1_000_000_000);
    await githubInstallationFactory.create({installationId: String(installationId), ...state});
    const provider = createGithubInstallationTokenProvider({
      getIntegrationConnectionById: vi.fn(),
    });

    await expect(provider.getInstallationAccessToken(installationId)).rejects.toMatchObject({
      reason: 'access-denied',
    });
    expect(createInstallationAccessTokenMock).not.toHaveBeenCalled();
  });

  it('does not share a cached token between permission profiles', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T11:00:00.000Z'));
    createInstallationAccessTokenMock
      .mockResolvedValueOnce({
        data: {token: 'ghs_broad', expires_at: '2026-06-10T12:00:00.000Z'},
      })
      .mockResolvedValueOnce({
        data: {token: 'ghs_narrow', expires_at: '2026-06-10T12:00:00.000Z'},
      });
    const provider = createGithubInstallationTokenProvider();

    const broad = await provider.getInstallationAccessToken(1, 'broad');
    const narrow = await provider.getInstallationAccessToken(1, 'narrow');
    const broadAgain = await provider.getInstallationAccessToken(1, 'broad');

    expect(broad.token).toBe('ghs_broad');
    expect(narrow.token).toBe('ghs_narrow');
    expect(broadAgain.token).toBe('ghs_broad');
    expect(createInstallationAccessTokenMock).toHaveBeenCalledTimes(2);
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
      _permissionFingerprint: string,
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
        read: (readWorkspaceId, readInstallationId, key) =>
          Promise.resolve(values.get(`${readWorkspaceId}:${readInstallationId}:${key}`) ?? null),
        write: (writeWorkspaceId, writeInstallationId, key, envelope) => {
          values.set(
            `${writeWorkspaceId}:${writeInstallationId}:${key}`,
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
    expect(
      values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      ),
    ).toContain(GITHUB_STATELESS_INSTALLATION_TOKEN);
    expect(lockCalls).toBe(2);
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
});
