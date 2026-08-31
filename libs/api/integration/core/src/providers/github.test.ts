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

import type {
  GithubCheckoutTokenCachePort,
  GithubCheckoutTokenScope,
} from '@shipfox/api-integration-github';
import {
  encodeInstallationTokenEnvelope,
  GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
  GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY,
  githubInstallationTokenKey,
  githubInstallationTokenNamespace,
} from '@shipfox/api-integration-github';
import {githubProviderModule} from '#providers/github.js';

const checkoutTokenStorageKeyPattern = /^CHECKOUT_TOKEN_V1_[A-F0-9]{64}$/u;

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
    const scopedDeleteSecrets = vi.fn(() => Promise.resolve(1));
    const deleteSecrets = vi.fn(() => Promise.resolve(1));

    const part = await githubProviderModule.load({
      secrets: {
        github: {
          getSecret,
          getSecretsByNamespace,
          setSecrets,
          deleteSecrets: scopedDeleteSecrets,
        },
        deleteSecrets,
      },
    });
    expect(part.workers).toHaveLength(1);

    const providerOptions = captured.integrationProviderOptions;
    if (!providerOptions || typeof providerOptions !== 'object') {
      throw new Error('GitHub integration provider options were not captured');
    }
    const checkoutTokenCache = (
      providerOptions as {
        checkoutTokenCache?: GithubCheckoutTokenCachePort;
      }
    ).checkoutTokenCache;
    if (!checkoutTokenCache) throw new Error('Expected exact-scope cache');

    const providerInstance = 'provider-instance';
    const scope: GithubCheckoutTokenScope = {
      workspaceId: 'workspace-1',
      providerInstance,
      installationId: 123,
      repositoryId: 456,
      permissions: {contents: 'read'},
    };
    const mint = vi.fn(() =>
      Promise.resolve({
        token: 'ghs_checkout',
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      }),
    );
    await checkoutTokenCache.getOrMint(scope, mint);
    await checkoutTokenCache.getOrMint(scope, mint);

    expect(mint).toHaveBeenCalledOnce();
    const secretCalls = getSecret.mock.calls as unknown as Array<
      [{workspaceId: string; namespace: string; key: string}]
    >;
    const checkoutSecretCall = secretCalls.find(
      ([params]) => params.namespace === `system/github/checkout-token/${providerInstance}/123`,
    );
    expect(checkoutSecretCall?.[0]).toMatchObject({
      workspaceId: 'workspace-1',
      namespace: `system/github/checkout-token/${providerInstance}/123`,
      key: expect.stringMatching(checkoutTokenStorageKeyPattern),
    });
    expect(getSecretsByNamespace).not.toHaveBeenCalled();
    const setSecretsCalls = setSecrets.mock.calls as unknown as Array<[unknown]>;
    const setSecretsCall = setSecretsCalls.at(-1)?.[0] as
      | {workspaceId: string; namespace: string; values: Record<string, string>}
      | undefined;
    expect(setSecretsCall).toMatchObject({
      workspaceId: 'workspace-1',
      namespace: `system/github/checkout-token/${providerInstance}/123`,
    });
    const storageKeys = Object.keys(setSecretsCall?.values ?? {});
    expect(storageKeys).toHaveLength(1);
    expect(storageKeys[0]).toBe(checkoutSecretCall?.[0].key);
    expect(storageKeys[0]).toMatch(checkoutTokenStorageKeyPattern);
    expect(setSecretsCall?.values[storageKeys[0] ?? '']).toEqual(expect.any(String));

    await checkoutTokenCache.deleteInstallation?.('workspace-1', providerInstance, 123);

    expect(scopedDeleteSecrets).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      namespace: `system/github/checkout-token/${providerInstance}/123`,
    });
    expect(deleteSecrets).not.toHaveBeenCalled();
  });
});
