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
  githubInstallationTokenNamespace,
  TOKEN_REFRESH_MARGIN_MS,
} from './installation-token-envelope.js';
import {
  type InstallationTokenCache,
  type InstallationTokenSecretStore,
  SharedInstallationTokenCache,
  type SharedInstallationTokenCacheOptions,
} from './shared-installation-token-cache.js';

export interface GithubInstallationTokenProvider {
  getInstallationAccessToken(installationId: number): Promise<GithubInstallationAccessToken>;
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

  async getInstallationAccessToken(installationId: number): Promise<GithubInstallationAccessToken> {
    await this.assertInstallationIsActive(installationId);
    return await this.cache.getOrMint(installationId, () =>
      this.mintInstallationAccessToken(installationId),
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
  ): Promise<GithubInstallationAccessToken> {
    const response = await mapGithubError(
      () =>
        this.getApp().octokit.rest.apps.createInstallationAccessToken({
          installation_id: installationId,
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
  private readonly tokens = new Map<number, GithubInstallationAccessToken>();
  private readonly inFlightMints = new Map<number, Promise<GithubInstallationAccessToken>>();

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
    mint: () => Promise<GithubInstallationAccessToken>,
  ): Promise<GithubInstallationAccessToken> {
    const cached = this.tokens.get(installationId);
    if (cached && !this.isInsideRefreshMargin(cached.expiresAt)) {
      recordInstallationTokenLookup('ram-hit');
      return Promise.resolve(cached);
    }

    const inFlightMint = this.inFlightMints.get(installationId);
    if (inFlightMint) return inFlightMint;

    const freshToken = mint()
      .then((token) => {
        this.tokens.set(installationId, token);
        return token;
      })
      .finally(() => {
        this.inFlightMints.delete(installationId);
      });
    this.inFlightMints.set(installationId, freshToken);
    return freshToken;
  }

  private isInsideRefreshMargin(expiresAt: Date): boolean {
    return expiresAt.getTime() <= this.options.now().getTime() + this.options.refreshMarginMs;
  }
}

class TieredInstallationTokenCache implements InstallationTokenCache {
  constructor(
    private readonly ram: InstallationTokenCache,
    private readonly shared: InstallationTokenCache,
  ) {}

  getOrMint(
    installationId: number,
    mint: () => Promise<GithubInstallationAccessToken>,
  ): Promise<GithubInstallationAccessToken> {
    return this.ram.getOrMint(installationId, () => this.shared.getOrMint(installationId, mint));
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
