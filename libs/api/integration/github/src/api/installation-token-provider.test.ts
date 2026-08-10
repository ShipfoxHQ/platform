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
    function withLock<T>(_installationId: number, fn: () => Promise<T>) {
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
        read: (readWorkspaceId, readInstallationId) =>
          Promise.resolve(values.get(`${readWorkspaceId}:${readInstallationId}`) ?? null),
        write: (writeWorkspaceId, writeInstallationId, envelope) => {
          values.set(
            `${writeWorkspaceId}:${writeInstallationId}`,
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
});
