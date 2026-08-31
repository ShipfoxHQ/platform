const captured = vi.hoisted(() => ({providerOptions: undefined as unknown}));

vi.mock('@shipfox/api-integration-github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipfox/api-integration-github')>();
  const originalCreate = actual.createGithubInstallationTokenProvider;

  return {
    ...actual,
    createGithubInstallationTokenProvider: vi.fn(
      (options: Parameters<typeof originalCreate>[0]) => {
        captured.providerOptions = options;
        return originalCreate(options);
      },
    ),
  };
});

import {
  encodeInstallationTokenEnvelope,
  GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY,
  githubInstallationTokenNamespace,
} from '@shipfox/api-integration-github';
import {githubProviderModule} from '#providers/github.js';

type SecretStore = {
  read: (workspaceId: string, installationId: number) => Promise<string | null>;
  write: (
    workspaceId: string,
    installationId: number,
    envelope: {token?: string; expiresAt?: Date},
  ) => Promise<void>;
};

describe('githubProviderModule', () => {
  it('uses the GitHub package contract for the shared installation-token envelope', async () => {
    const cachedEnvelope = '{"token":"ghs_cached"}';
    const getSecret = vi.fn();
    getSecret.mockResolvedValueOnce(cachedEnvelope).mockResolvedValueOnce(undefined);
    const setSecrets = vi.fn(() => Promise.resolve());
    const deleteSecrets = vi.fn(() => Promise.resolve(0));

    await githubProviderModule.load({
      secrets: {
        github: {getSecret, setSecrets, deleteSecrets},
        deleteSecrets,
      },
    });

    const providerOptions = captured.providerOptions;
    if (!providerOptions || typeof providerOptions !== 'object') {
      throw new Error('GitHub installation-token provider options were not captured');
    }
    const secretStore = (providerOptions as {secretStore?: SecretStore}).secretStore;
    if (!secretStore) throw new Error('GitHub installation-token secret store was not configured');

    const workspaceId = 'workspace-1';
    const installationId = 123;
    const namespace = githubInstallationTokenNamespace(installationId);
    const readHit = await secretStore.read(workspaceId, installationId);
    const readMiss = await secretStore.read(workspaceId, installationId);
    const envelope = {
      token: 'ghs_cached',
      expiresAt: new Date('2026-06-10T12:00:00.000Z'),
    };
    await secretStore.write(workspaceId, installationId, envelope);

    expect(readHit).toBe(cachedEnvelope);
    expect(readMiss).toBeNull();
    expect(GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY).toBe('ENVELOPE');
    expect(getSecret).toHaveBeenNthCalledWith(1, {
      workspaceId,
      namespace,
      key: GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY,
    });
    expect(getSecret).toHaveBeenNthCalledWith(2, {
      workspaceId,
      namespace,
      key: GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY,
    });
    expect(setSecrets).toHaveBeenCalledWith({
      workspaceId,
      namespace,
      values: {
        [GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY]: encodeInstallationTokenEnvelope(envelope),
      },
    });
  });
});
