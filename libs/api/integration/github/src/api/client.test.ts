import {GithubIntegrationProviderError} from '#core/errors.js';
import {GITHUB_STATELESS_INSTALLATION_TOKEN} from '#test/index.js';
import {createGithubApiClient, mapGithubError} from './client.js';

const {createInstallationAccessTokenMock, RequestErrorMock} = vi.hoisted(() => {
  class RequestErrorMock extends Error {
    constructor(
      message: string,
      public readonly status: number,
    ) {
      super(message);
      this.name = 'HttpError';
    }
  }

  return {createInstallationAccessTokenMock: vi.fn(), RequestErrorMock};
});

vi.mock('octokit', () => ({
  App: class App {
    octokit = {
      rest: {apps: {createInstallationAccessToken: createInstallationAccessTokenMock}},
    };
  },
  Octokit: {
    defaults(options: unknown) {
      return {defaults: options};
    },
  },
  RequestError: RequestErrorMock,
}));

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
    expect(GITHUB_STATELESS_INSTALLATION_TOKEN).toHaveLength(520);
    expect(createInstallationAccessTokenMock).toHaveBeenCalledWith({
      installation_id: 1,
      repository_ids: [42],
      permissions: {contents: 'read'},
      headers: {'X-GitHub-Stateless-S2S-Token': 'enabled'},
    });
  });

  it('mints a repository-scoped write installation token when requested', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {token: 'ghs_installationtoken', expires_at: '2026-06-10T12:00:00.000Z'},
    });
    const client = createGithubApiClient();

    await client.createInstallationAccessToken({
      installationId: 1,
      repositoryId: 42,
      permissions: {contents: 'write'},
    });

    expect(createInstallationAccessTokenMock).toHaveBeenCalledWith({
      installation_id: 1,
      repository_ids: [42],
      permissions: {contents: 'write'},
      headers: {'X-GitHub-Stateless-S2S-Token': 'enabled'},
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
