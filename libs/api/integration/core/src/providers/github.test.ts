const captured = vi.hoisted(() => ({
  integrationProviderOptions: undefined as unknown,
  providerOptions: undefined as unknown,
}));

vi.mock('@shipfox/api-integration-github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipfox/api-integration-github')>();
  const originalCreate = actual.createGithubInstallationTokenProvider;
  const originalCreateIntegrationProvider = actual.createGithubIntegrationProvider;

  return {
    ...actual,
    createGithubIntegrationProvider: vi.fn(
      (options: Parameters<typeof originalCreateIntegrationProvider>[0]) => {
        captured.integrationProviderOptions = options;
        return originalCreateIntegrationProvider(options);
      },
    ),
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
  GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
  GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY,
  githubInstallationTokenKey,
  githubInstallationTokenNamespace,
} from '@shipfox/api-integration-github';
import {githubProviderModule} from '#providers/github.js';

type SecretStore = {
  read: (workspaceId: string, installationId: number, key: string) => Promise<string | null>;
  write: (
    workspaceId: string,
    installationId: number,
    key: string,
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
    const profileKey = githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT);
    const readHit = await secretStore.read(workspaceId, installationId, profileKey);
    const readMiss = await secretStore.read(workspaceId, installationId, profileKey);
    const envelope = {
      token: 'ghs_cached',
      expiresAt: new Date('2026-06-10T12:00:00.000Z'),
    };
    await secretStore.write(workspaceId, installationId, profileKey, envelope);

    expect(readHit).toBe(cachedEnvelope);
    expect(readMiss).toBeNull();
    expect(GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY).toBe('ENVELOPE');
    expect(getSecret).toHaveBeenNthCalledWith(1, {
      workspaceId,
      namespace,
      key: profileKey,
    });
    expect(getSecret).toHaveBeenNthCalledWith(2, {
      workspaceId,
      namespace,
      key: profileKey,
    });
    expect(setSecrets).toHaveBeenCalledWith({
      workspaceId,
      namespace,
      values: {
        [profileKey]: encodeInstallationTokenEnvelope(envelope),
      },
    });
  });

  it('wires the exact-scope cache to the scoped GitHub Secrets adapter', async () => {
    const getSecret = vi.fn(() => Promise.resolve(null));
    const getSecretsByNamespace = vi.fn(() => Promise.resolve({}));
    const setSecrets = vi.fn(() => Promise.resolve());
    const deleteSecrets = vi.fn(() => Promise.resolve(1));

    await githubProviderModule.load({
      secrets: {
        github: {getSecret, getSecretsByNamespace, setSecrets, deleteSecrets},
        deleteSecrets,
      },
    });

    const providerOptions = captured.integrationProviderOptions;
    if (!providerOptions || typeof providerOptions !== 'object') {
      throw new Error('GitHub integration provider options were not captured');
    }
    const checkoutTokenCache = (
      providerOptions as {
        checkoutTokenCache?: {
          deleteInstallation?: (
            workspaceId: string,
            providerInstance: string,
            installationId: number,
          ) => Promise<number>;
        };
      }
    ).checkoutTokenCache;
    expect(checkoutTokenCache).toBeDefined();

    const providerInstance = 'provider-instance';
    await checkoutTokenCache?.deleteInstallation?.('workspace-1', providerInstance, 123);

    expect(deleteSecrets).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      namespace: `system/github/checkout-token/${providerInstance}/123`,
    });
  });
});
