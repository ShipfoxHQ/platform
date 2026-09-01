import type {GetIntegrationConnectionByIdFn} from '@shipfox/api-integration-spi';
import {App, Octokit} from 'octokit';
import {config, normalizedGithubApiBaseUrl, normalizedGithubPrivateKey} from '#config.js';
import {GithubIntegrationProviderError} from '#core/errors.js';
import {withInstallationTokenLock} from '#db/installation-token-lock.js';
import {getGithubInstallationByInstallationId} from '#db/installations.js';
import {recordInstallationTokenFormat, recordInstallationTokenLookup} from '#metrics/index.js';
import {type GithubInstallationAccessToken, mapGithubError} from './client.js';
import {githubInstallationTokenFormatPlugin} from './github-octokit.js';
import {
  GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
  type GithubInstallationTokenPermissions,
  githubInstallationTokenKey,
  githubInstallationTokenNamespace,
  githubInstallationTokenPermissionFingerprint,
  TOKEN_REFRESH_MARGIN_MS,
} from './installation-token-envelope.js';
import {
  type InstallationTokenCache,
  type InstallationTokenSecretStore,
  SharedInstallationTokenCache,
  type SharedInstallationTokenCacheOptions,
} from './shared-installation-token-cache.js';

export interface GithubInstallationTokenProvider {
  getInstallationAccessToken(
    installationId: number,
    permissionFingerprint?: string,
    permissions?: GithubInstallationTokenPermissions,
  ): Promise<GithubInstallationAccessToken>;
}

export interface GithubInstallationTokenProviderOptions {
  cache?: InstallationTokenCache | undefined;
  getIntegrationConnectionById?: GetIntegrationConnectionByIdFn | undefined;
  getGithubInstallationByInstallationId?: typeof getGithubInstallationByInstallationId | undefined;
  secretStore?: InstallationTokenSecretStore | undefined;
  withLock?: SharedInstallationTokenCacheOptions['withLock'] | undefined;
  now?: (() => Date) | undefined;
}

export function createGithubInstallationTokenProvider(
  options: GithubInstallationTokenProviderOptions = {},
): GithubInstallationTokenProvider {
  return new OctokitGithubInstallationTokenProvider(
    createInstallationTokenCache(options),
    options.getGithubInstallationByInstallationId ??
      (options.getIntegrationConnectionById ? getGithubInstallationByInstallationId : undefined),
  );
}

class OctokitGithubInstallationTokenProvider implements GithubInstallationTokenProvider {
  private app: App | undefined;

  constructor(
    private readonly cache: InstallationTokenCache = new InMemoryInstallationTokenCache(),
    private readonly getInstallationByInstallationId?: typeof getGithubInstallationByInstallationId,
  ) {}

  async getInstallationAccessToken(
    installationId: number,
    permissionFingerprint?: string,
    permissions?: GithubInstallationTokenPermissions,
  ): Promise<GithubInstallationAccessToken> {
    await this.assertInstallationIsActive(installationId);
    const derivedPermissionFingerprint =
      permissions === undefined
        ? undefined
        : githubInstallationTokenPermissionFingerprint(permissions);
    if (
      permissionFingerprint !== undefined &&
      derivedPermissionFingerprint !== undefined &&
      permissionFingerprint !== derivedPermissionFingerprint
    ) {
      throw new TypeError(
        'GitHub installation token permission fingerprint does not match permissions',
      );
    }
    const effectivePermissionFingerprint =
      derivedPermissionFingerprint ??
      permissionFingerprint ??
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT;
    const requestedPermissions = permissions === undefined ? undefined : {...permissions};
    return await this.cache.getOrMint(installationId, effectivePermissionFingerprint, () =>
      this.mintInstallationAccessToken(installationId, requestedPermissions),
    );
  }

  private async assertInstallationIsActive(installationId: number): Promise<void> {
    // Providers without integration composition (for example isolated unit callers) do
    // not have installation state available; production composition always supplies it.
    if (!this.getInstallationByInstallationId) return;
    const installation = await this.getInstallationByInstallationId(String(installationId));
    if (!installation || installation.suspendedAt !== null || installation.deletedAt !== null) {
      throw new GithubIntegrationProviderError(
        'access-denied',
        `GitHub installation is not active: ${installationId}`,
      );
    }
  }

  private async mintInstallationAccessToken(
    installationId: number,
    permissions: GithubInstallationTokenPermissions | undefined,
  ): Promise<GithubInstallationAccessToken> {
    const response = await mapGithubError(
      () =>
        this.getApp().octokit.rest.apps.createInstallationAccessToken({
          installation_id: installationId,
          ...(permissions === undefined ? {} : {permissions}),
        }),
      'installation-not-found',
    );

    if (typeof response.data.token !== 'string') {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub installation access token response did not include a token',
      );
    }

    recordInstallationTokenFormat(response.data.token);

    const expiresAt = new Date(response.data.expires_at);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub installation access token response did not include a valid expiry',
      );
    }

    return {
      token: response.data.token,
      expiresAt,
      ...(response.data.permissions === undefined ? {} : {permissions: response.data.permissions}),
    };
  }

  private getApp(): App {
    if (!this.app) {
      this.app = new App({
        appId: config.GITHUB_APP_ID,
        privateKey: normalizedGithubPrivateKey(),
        Octokit: Octokit.plugin(githubInstallationTokenFormatPlugin).defaults({
          baseUrl: normalizedGithubApiBaseUrl(),
          throttle: {
            onRateLimit: (
              _retryAfter: number,
              _options: unknown,
              _octokit: unknown,
              retryCount: number,
            ) => retryCount === 0,
            onSecondaryRateLimit: (
              _retryAfter: number,
              _options: unknown,
              _octokit: unknown,
              retryCount: number,
            ) => retryCount === 0,
          },
        }),
      });
    }
    return this.app;
  }
}

class InMemoryInstallationTokenCache implements InstallationTokenCache {
  private readonly tokens = new Map<string, GithubInstallationAccessToken>();
  private readonly inFlightMints = new Map<string, Promise<GithubInstallationAccessToken>>();

  constructor(
    private readonly options: {
      refreshMarginMs: number;
      now: () => Date;
    } = {
      refreshMarginMs: TOKEN_REFRESH_MARGIN_MS,
      now: () => new Date(),
    },
  ) {}

  getOrMint(
    installationId: number,
    permissionFingerprint: string,
    mint: () => Promise<GithubInstallationAccessToken>,
  ): Promise<GithubInstallationAccessToken> {
    const cacheKey = installationTokenCacheKey(installationId, permissionFingerprint);
    const cached = this.tokens.get(cacheKey);
    if (cached && !this.isInsideRefreshMargin(cached.expiresAt)) {
      recordInstallationTokenLookup('ram-hit');
      return Promise.resolve(cached);
    }

    const inFlightMint = this.inFlightMints.get(cacheKey);
    if (inFlightMint) return inFlightMint;

    const freshToken = mint()
      .then((token) => {
        this.tokens.set(cacheKey, token);
        return token;
      })
      .finally(() => {
        this.inFlightMints.delete(cacheKey);
      });
    this.inFlightMints.set(cacheKey, freshToken);
    return freshToken;
  }

  private isInsideRefreshMargin(expiresAt: Date): boolean {
    return expiresAt.getTime() <= this.options.now().getTime() + this.options.refreshMarginMs;
  }
}

function installationTokenCacheKey(installationId: number, permissionFingerprint: string): string {
  return `${installationId}\u0000${githubInstallationTokenKey(permissionFingerprint)}`;
}

class TieredInstallationTokenCache implements InstallationTokenCache {
  constructor(
    private readonly ram: InstallationTokenCache,
    private readonly shared: InstallationTokenCache,
  ) {}

  getOrMint(
    installationId: number,
    permissionFingerprint: string,
    mint: () => Promise<GithubInstallationAccessToken>,
  ): Promise<GithubInstallationAccessToken> {
    return this.ram.getOrMint(installationId, permissionFingerprint, () =>
      this.shared.getOrMint(installationId, permissionFingerprint, mint),
    );
  }
}

function createInstallationTokenCache(
  options: GithubInstallationTokenProviderOptions,
): InstallationTokenCache {
  if (options.cache) return options.cache;

  const ram = new InMemoryInstallationTokenCache({
    refreshMarginMs: TOKEN_REFRESH_MARGIN_MS,
    now: options.now ?? (() => new Date()),
  });
  if (!options.getIntegrationConnectionById || !options.secretStore) return ram;

  const shared = new SharedInstallationTokenCache({
    secretStore: options.secretStore,
    withLock: options.withLock ?? withInstallationTokenLock,
    resolveWorkspaceId: createGithubInstallationWorkspaceResolver(
      options.getIntegrationConnectionById,
    ),
    now: options.now,
  });
  return new TieredInstallationTokenCache(ram, shared);
}

function createGithubInstallationWorkspaceResolver(
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn,
) {
  return async (installationId: number): Promise<string> => {
    const installation = await getGithubInstallationByInstallationId(String(installationId));
    if (!installation) {
      throw new GithubIntegrationProviderError(
        'installation-not-found',
        `GitHub installation not found: ${installationId}`,
      );
    }

    const connection = await getIntegrationConnectionById(installation.connectionId);
    if (!connection) {
      throw new GithubIntegrationProviderError(
        'installation-not-found',
        `GitHub installation connection not found: ${installation.connectionId}`,
      );
    }
    return connection.workspaceId;
  };
}

export function deleteGithubInstallationTokenSecret(params: {
  workspaceId: string;
  installationId: number;
  deleteSecrets: (params: {workspaceId: string; namespace: string}) => Promise<number>;
}): Promise<number> {
  return params.deleteSecrets({
    workspaceId: params.workspaceId,
    namespace: githubInstallationTokenNamespace(params.installationId),
  });
}
