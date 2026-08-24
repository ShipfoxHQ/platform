import type {GetIntegrationConnectionByIdFn} from '@shipfox/api-integration-spi';
import {App, Octokit} from 'octokit';
import {config, normalizedGithubApiBaseUrl, normalizedGithubPrivateKey} from '#config.js';
import {GithubIntegrationProviderError} from '#core/errors.js';
import {withInstallationTokenLock} from '#db/installation-token-lock.js';
import {getGithubInstallationByInstallationId} from '#db/installations.js';
import {recordInstallationTokenFormat, recordInstallationTokenLookup} from '#metrics/index.js';
import {type GithubInstallationAccessToken, mapGithubError} from './client.js';
import {
  getGithubInstallationOctokit,
  githubInstallationTokenFormatPlugin,
} from './github-octokit.js';
import {
  type GithubInstallationTokenScope,
  githubInstallationTokenNamespace,
  githubInstallationTokenScopeKey,
  TOKEN_REFRESH_MARGIN_MS,
} from './installation-token-envelope.js';
import {
  type InstallationTokenCache,
  type InstallationTokenSecretStore,
  SharedInstallationTokenCache,
  type SharedInstallationTokenCacheOptions,
} from './shared-installation-token-cache.js';

export type {GithubInstallationTokenScope} from './installation-token-envelope.js';

export interface GithubInstallationTokenProvider {
  getInstallationAccessToken(
    installationId: number,
    scope?: GithubInstallationTokenScope | undefined,
  ): Promise<GithubInstallationAccessToken>;
}

export interface ResolveGithubInstallationRepositoryInput {
  installationId: number;
  fullName: string;
}

export interface GithubInstallationRepositoryResolver {
  resolveRepositoryId(input: ResolveGithubInstallationRepositoryInput): Promise<number>;
}

export interface GithubInstallationTokenProviderOptions {
  cache?: InstallationTokenCache | undefined;
  getIntegrationConnectionById?: GetIntegrationConnectionByIdFn | undefined;
  secretStore?: InstallationTokenSecretStore | undefined;
  withLock?: SharedInstallationTokenCacheOptions['withLock'] | undefined;
  now?: (() => Date) | undefined;
}

const INSTALLATION_REPOSITORY_RESOLUTION_PAGE_SIZE = 100;
const INSTALLATION_REPOSITORY_RESOLUTION_CACHE_TTL_MS = 5 * 60 * 1000;

export function createGithubInstallationTokenProvider(
  options: GithubInstallationTokenProviderOptions = {},
): GithubInstallationTokenProvider & GithubInstallationRepositoryResolver {
  return new OctokitGithubInstallationTokenProvider(
    createInstallationTokenCache(options),
    options.now,
  );
}

class OctokitGithubInstallationTokenProvider
  implements GithubInstallationTokenProvider, GithubInstallationRepositoryResolver
{
  private app: App | undefined;
  private readonly resolutionCache = new Map<string, {repositoryId: number; expiresAtMs: number}>();
  private readonly now: () => Date;

  constructor(
    private readonly cache: InstallationTokenCache = new InMemoryInstallationTokenCache(),
    now?: (() => Date) | undefined,
  ) {
    this.now = now ?? (() => new Date());
  }

  getInstallationAccessToken(
    installationId: number,
    scope?: GithubInstallationTokenScope | undefined,
  ): Promise<GithubInstallationAccessToken> {
    return this.cache.getOrMint(
      installationId,
      () => this.mintInstallationAccessToken(installationId, scope),
      scope,
    );
  }

  async resolveRepositoryId(input: ResolveGithubInstallationRepositoryInput): Promise<number> {
    const needle = input.fullName.trim().toLowerCase();
    const cacheKey = `${input.installationId}:${needle}`;
    this.pruneResolutionCache();
    const cached = this.resolutionCache.get(cacheKey);
    if (cached !== undefined && cached.expiresAtMs > this.now().getTime()) {
      return cached.repositoryId;
    }

    const octokit = await mapGithubError(
      () => getGithubInstallationOctokit(this.getApp(), input.installationId),
      'installation-not-found',
    );

    for (let page = 1; ; page += 1) {
      const response = await mapGithubError(() =>
        octokit.rest.apps.listReposAccessibleToInstallation({
          per_page: INSTALLATION_REPOSITORY_RESOLUTION_PAGE_SIZE,
          page,
        }),
      );
      const match = response.data.repositories.find((repository) => {
        if (typeof repository.full_name !== 'string') {
          throw new GithubIntegrationProviderError(
            'malformed-provider-response',
            'GitHub repository resolution did not include a repository name',
          );
        }
        return repository.full_name.toLowerCase() === needle;
      });
      if (match !== undefined) {
        if (!Number.isSafeInteger(match.id) || match.id < 1) {
          throw new GithubIntegrationProviderError(
            'malformed-provider-response',
            'GitHub repository resolution did not include a valid repository id',
          );
        }
        this.resolutionCache.set(cacheKey, {
          repositoryId: match.id,
          expiresAtMs: this.now().getTime() + INSTALLATION_REPOSITORY_RESOLUTION_CACHE_TTL_MS,
        });
        return match.id;
      }
      // Stop at the reported repository count so an inaccessible repository (the
      // access-denied path) does not page past every accessible repository.
      if (
        response.data.repositories.length < INSTALLATION_REPOSITORY_RESOLUTION_PAGE_SIZE ||
        (typeof response.data.total_count === 'number' &&
          page * INSTALLATION_REPOSITORY_RESOLUTION_PAGE_SIZE >= response.data.total_count)
      ) {
        break;
      }
    }

    throw new GithubIntegrationProviderError(
      'access-denied',
      `GitHub repository ${input.fullName} is not accessible to the GitHub installation`,
    );
  }

  private pruneResolutionCache(): void {
    const nowMs = this.now().getTime();
    for (const [key, entry] of this.resolutionCache) {
      if (entry.expiresAtMs <= nowMs) {
        this.resolutionCache.delete(key);
      }
    }
  }

  private async mintInstallationAccessToken(
    installationId: number,
    scope: GithubInstallationTokenScope | undefined,
  ): Promise<GithubInstallationAccessToken> {
    const response = await mapGithubError(
      () =>
        this.getApp().octokit.rest.apps.createInstallationAccessToken({
          installation_id: installationId,
          ...(scope === undefined
            ? {}
            : {
                repository_ids: [scope.repositoryId],
                permissions: scope.permissions,
              }),
        }),
      // GitHub returns 404 both for a missing installation and for a repository the
      // installation cannot access. Unscoped mints are installation-not-found;
      // scoped mints carry repository_ids, so a 404 means the repository is not
      // accessible to the installation (consistent with resolveRepositoryId).
      scope === undefined ? 'installation-not-found' : 'access-denied',
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
      this.app = createGithubApp();
    }
    return this.app;
  }
}

function createGithubApp(): App {
  return new App({
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
    mint: () => Promise<GithubInstallationAccessToken>,
    scope?: GithubInstallationTokenScope | undefined,
  ): Promise<GithubInstallationAccessToken> {
    this.pruneExpired();
    const key = installationTokenCacheKey(installationId, scope);
    const cached = this.tokens.get(key);
    if (cached && !this.isInsideRefreshMargin(cached.expiresAt)) {
      recordInstallationTokenLookup('ram-hit');
      return Promise.resolve(cached);
    }

    const inFlightMint = this.inFlightMints.get(key);
    if (inFlightMint) return inFlightMint;

    const freshToken = mint()
      .then((token) => {
        this.tokens.set(key, token);
        return token;
      })
      .finally(() => {
        this.inFlightMints.delete(key);
      });
    this.inFlightMints.set(key, freshToken);
    return freshToken;
  }

  private isInsideRefreshMargin(expiresAt: Date): boolean {
    return expiresAt.getTime() <= this.options.now().getTime() + this.options.refreshMarginMs;
  }

  // Entries are keyed by (installation, scope), so a long-lived process would
  // otherwise keep one slot per scope ever minted. Sweep on access so entries
  // only survive while their token could still be served.
  private pruneExpired(): void {
    const now = this.options.now().getTime();
    for (const [key, token] of this.tokens) {
      if (token.expiresAt.getTime() <= now) {
        this.tokens.delete(key);
      }
    }
  }
}

function installationTokenCacheKey(
  installationId: number,
  scope: GithubInstallationTokenScope | undefined,
): string {
  return scope === undefined
    ? String(installationId)
    : `${installationId}:${githubInstallationTokenScopeKey(scope)}`;
}

class TieredInstallationTokenCache implements InstallationTokenCache {
  constructor(
    private readonly ram: InstallationTokenCache,
    private readonly shared: InstallationTokenCache,
  ) {}

  getOrMint(
    installationId: number,
    mint: () => Promise<GithubInstallationAccessToken>,
    scope?: GithubInstallationTokenScope | undefined,
  ): Promise<GithubInstallationAccessToken> {
    return this.ram.getOrMint(
      installationId,
      () => this.shared.getOrMint(installationId, mint, scope),
      scope,
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
