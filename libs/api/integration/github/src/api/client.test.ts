import {GithubIntegrationProviderError} from '#core/errors.js';
import {
  GITHUB_STATEFUL_INSTALLATION_TOKEN,
  GITHUB_STATELESS_INSTALLATION_TOKEN,
} from '#test/index.js';
import {createGithubApiClient, mapGithubError} from './client.js';

const GITHUB_INSTALLATION_TOKEN_PATTERN = /^ghs_[A-Za-z0-9._-]{36,}$/u;

const {createInstallationAccessTokenMock, getByUsernameMock, octokitOptionsMock, RequestErrorMock} =
  vi.hoisted(() => {
    class RequestErrorMock extends Error {
      constructor(
        message: string,
        public readonly status: number,
      ) {
        super(message);
        this.name = 'HttpError';
      }
    }

    return {
      createInstallationAccessTokenMock: vi.fn(),
      getByUsernameMock: vi.fn(),
      octokitOptionsMock: vi.fn(),
      RequestErrorMock,
    };
  });

vi.mock('octokit', () => ({
  App: class App {
    octokit = {
      rest: {
        apps: {createInstallationAccessToken: createInstallationAccessTokenMock},
        users: {getByUsername: getByUsernameMock},
      },
    };
  },
  Octokit: class Octokit {
    rest = {users: {getByUsername: getByUsernameMock}};

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

describe('OctokitGithubApiClient.getBotUser', () => {
  beforeEach(() => {
    getByUsernameMock.mockReset();
    octokitOptionsMock.mockReset();
  });

  it('shares one lookup for concurrent requests and caches the bot for the process', async () => {
    getByUsernameMock.mockResolvedValue({
      data: {id: 307_629_549, login: 'shipfox-ai[bot]', type: 'Bot'},
    });
    const client = createGithubApiClient();

    const firstLookup = client.getBotUser({
      username: 'shipfox-ai[bot]',
      installationAccessToken: 'ghs_first',
    });
    const secondLookup = client.getBotUser({
      username: 'SHIPFOX-AI[BOT]',
      installationAccessToken: 'ghs_second',
    });
    const [first, second] = await Promise.all([firstLookup, secondLookup]);
    const cached = await client.getBotUser({
      username: 'shipfox-ai[bot]',
      installationAccessToken: 'ghs_third',
    });

    expect(first).toEqual({id: 307_629_549, login: 'shipfox-ai[bot]'});
    expect(second).toEqual(first);
    expect(cached).toEqual(first);
    expect(getByUsernameMock).toHaveBeenCalledTimes(1);
    expect(getByUsernameMock).toHaveBeenCalledWith({username: 'shipfox-ai[bot]'});
    expect(octokitOptionsMock).toHaveBeenCalledWith({
      auth: 'ghs_first',
      baseUrl: 'https://api.github.com',
    });
  });

  it('evicts a failed lookup so a later request can retry', async () => {
    getByUsernameMock
      .mockRejectedValueOnce(new RequestErrorMock('GitHub unavailable', 503))
      .mockResolvedValueOnce({
        data: {id: 307_629_549, login: 'shipfox-ai[bot]', type: 'Bot'},
      });
    const client = createGithubApiClient();

    const failed = client.getBotUser({
      username: 'shipfox-ai[bot]',
      installationAccessToken: 'ghs_first',
    });
    await expect(failed).rejects.toMatchObject({reason: 'provider-unavailable'});
    const retried = await client.getBotUser({
      username: 'shipfox-ai[bot]',
      installationAccessToken: 'ghs_second',
    });

    expect(retried).toEqual({id: 307_629_549, login: 'shipfox-ai[bot]'});
    expect(getByUsernameMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a response that does not identify a bot user', async () => {
    getByUsernameMock.mockResolvedValue({
      data: {id: 307_629_549, login: 'shipfox-ai[bot]', type: 'User'},
    });
    const client = createGithubApiClient();

    const result = client.getBotUser({
      username: 'shipfox-ai[bot]',
      installationAccessToken: 'ghs_installationtoken',
    });

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });
});

describe('mapGithubError', () => {
  it.each([400, 409, 422])('maps HTTP %i to a terminal provider rejection', async (status) => {
    const error = new RequestErrorMock(`GitHub rejected request with HTTP ${status}`, status);

    const result = mapGithubError(() => Promise.reject(error));

    await expect(result).rejects.toMatchObject({
      reason: 'provider-rejected',
      message: `GitHub rejected request with HTTP ${status}`,
      status,
    });
  });

  it('preserves the status when mapping provider unavailability', async () => {
    const error = new RequestErrorMock('GitHub is unavailable', 503);

    const result = mapGithubError(() => Promise.reject(error));

    await expect(result).rejects.toMatchObject({
      reason: 'provider-unavailable',
      message: 'GitHub is unavailable',
      status: 503,
    });
  });
});

describe('OctokitGithubApiClient.createInstallationAccessToken', () => {
  beforeEach(() => {
    createInstallationAccessTokenMock.mockReset();
  });

  it('mints a repository-scoped, read-only installation token', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {
        token: GITHUB_STATELESS_INSTALLATION_TOKEN,
        expires_at: '2026-06-10T12:00:00.000Z',
      },
    });
    const client = createGithubApiClient();

    const result = await client.createInstallationAccessToken({
      installationId: 1,
      repositoryId: 42,
    });

    expect(result).toEqual({
      token: GITHUB_STATELESS_INSTALLATION_TOKEN,
      expiresAt: new Date('2026-06-10T12:00:00.000Z'),
    });
    expect(GITHUB_STATELESS_INSTALLATION_TOKEN).toMatch(GITHUB_INSTALLATION_TOKEN_PATTERN);
    expect(GITHUB_STATELESS_INSTALLATION_TOKEN.slice(4).split('.')).toHaveLength(3);
    expect(createInstallationAccessTokenMock).toHaveBeenCalledWith({
      installation_id: 1,
      repository_ids: [42],
      permissions: {contents: 'read'},
    });
  });

  it('passes through a stateful repository-scoped write token', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {
        token: GITHUB_STATEFUL_INSTALLATION_TOKEN,
        expires_at: '2026-06-10T12:00:00.000Z',
      },
    });
    const client = createGithubApiClient();

    const result = await client.createInstallationAccessToken({
      installationId: 1,
      repositoryId: 42,
      permissions: {contents: 'write'},
    });

    expect(result.token).toBe(GITHUB_STATEFUL_INSTALLATION_TOKEN);
    expect(GITHUB_STATEFUL_INSTALLATION_TOKEN).toMatch(GITHUB_INSTALLATION_TOKEN_PATTERN);
    expect(GITHUB_STATEFUL_INSTALLATION_TOKEN).not.toContain('.');
    expect(createInstallationAccessTokenMock).toHaveBeenCalledWith({
      installation_id: 1,
      repository_ids: [42],
      permissions: {contents: 'write'},
    });
  });

  it('rejects a response without a token', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {expires_at: '2026-06-10T12:00:00.000Z'},
    });
    const client = createGithubApiClient();

    const result = client.createInstallationAccessToken({installationId: 1, repositoryId: 42});

    await expect(result).rejects.toMatchObject({
      reason: 'malformed-provider-response',
    });
    await expect(result).rejects.toBeInstanceOf(GithubIntegrationProviderError);
  });

  it('rejects a response with a missing or unparseable expiry', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {token: 'ghs_installationtoken'},
    });
    const client = createGithubApiClient();

    const result = client.createInstallationAccessToken({installationId: 1, repositoryId: 42});

    await expect(result).rejects.toMatchObject({
      reason: 'malformed-provider-response',
    });
  });
});
