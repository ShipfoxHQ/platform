const mocks = vi.hoisted(() => ({
  createGithubE2eRoutes: vi.fn(() => []),
  createGithubInstallationTokenProvider: vi.fn(() => ({
    getInstallationAccessToken: vi.fn(),
  })),
  createGithubIntegrationProvider: vi.fn(() => ({
    adapters: {},
    displayName: 'GitHub',
    provider: 'github',
    routes: [],
    webhookProcessors: [],
  })),
  encodeInstallationTokenEnvelope: vi.fn(() => 'encoded-envelope'),
  getGithubInstallationByInstallationId: vi.fn(),
  githubInstallationTokenNamespace: (installationId: number) =>
    `system/github/installation-token/${installationId}`,
  upsertGithubInstallation: vi.fn(),
  githubDb: vi.fn(),
}));

vi.mock('@shipfox/api-integration-github', () => ({
  createGithubE2eRoutes: mocks.createGithubE2eRoutes,
  createGithubInstallationTokenProvider: mocks.createGithubInstallationTokenProvider,
  createGithubIntegrationProvider: mocks.createGithubIntegrationProvider,
  encodeInstallationTokenEnvelope: mocks.encodeInstallationTokenEnvelope,
  getGithubInstallationByInstallationId: mocks.getGithubInstallationByInstallationId,
  githubInstallationTokenNamespace: mocks.githubInstallationTokenNamespace,
  migrationsPath: 'test-migrations',
  db: mocks.githubDb,
  upsertGithubInstallation: mocks.upsertGithubInstallation,
}));

import {githubProviderModule} from '#providers/github.js';

const SECRET_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/u;

describe('githubProviderModule', () => {
  beforeEach(() => {
    mocks.createGithubInstallationTokenProvider.mockClear();
    mocks.createGithubIntegrationProvider.mockClear();
    mocks.encodeInstallationTokenEnvelope.mockClear();
  });

  it('uses a Secrets-compatible key for the shared installation-token envelope', async () => {
    const getSecret = vi.fn(() => Promise.resolve(null));
    const setSecrets = vi.fn(() => Promise.resolve());
    const deleteSecrets = vi.fn(() => Promise.resolve(0));

    await githubProviderModule.load({
      secrets: {
        github: {getSecret, setSecrets, deleteSecrets},
        deleteSecrets,
      },
    });

    const providerOptions = (
      mocks.createGithubInstallationTokenProvider.mock.calls as unknown[][]
    )[0]?.[0];
    if (!providerOptions || typeof providerOptions !== 'object') {
      throw new Error('GitHub installation-token provider options were not captured');
    }
    const secretStore = (
      providerOptions as {
        secretStore: {
          read: (workspaceId: string, installationId: number) => Promise<string | null>;
          write: (
            workspaceId: string,
            installationId: number,
            envelope: {token?: string; expiresAt?: Date},
          ) => Promise<void>;
        };
      }
    ).secretStore;
    const workspaceId = 'workspace-1';
    const installationId = 123;
    const namespace = 'system/github/installation-token/123';

    await secretStore.read(workspaceId, installationId);
    await secretStore.write(workspaceId, installationId, {
      token: 'ghs_cached',
      expiresAt: new Date('2026-06-10T12:00:00.000Z'),
    });

    expect(getSecret).toHaveBeenCalledWith({
      workspaceId,
      namespace,
      key: 'ENVELOPE',
    });
    expect(setSecrets).toHaveBeenCalledWith({
      workspaceId,
      namespace,
      values: {ENVELOPE: 'encoded-envelope'},
    });
    expect('ENVELOPE').toMatch(SECRET_KEY_PATTERN);
  });
});
