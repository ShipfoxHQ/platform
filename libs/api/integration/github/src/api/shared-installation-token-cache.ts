import {setTimeout as sleepTimeout} from 'node:timers/promises';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {GithubIntegrationProviderError} from '#core/errors.js';
import {
  recordInstallationTokenBackoff,
  recordInstallationTokenLookup,
  recordInstallationTokenMint,
} from '#metrics/index.js';
import type {GithubInstallationAccessToken} from './client.js';
import {
  backoffActive,
  backoffMs,
  type ClassifiedMintError,
  classifyMintError,
  type GithubInstallationTokenScope,
  githubInstallationTokenScopeKey,
  type InstallationTokenEnvelope,
  mintErrorClassForReason,
  parseInstallationTokenEnvelope,
  providerErrorFromBackoff,
  stillValid,
  toProviderError,
  usable,
} from './installation-token-envelope.js';

export interface InstallationTokenCache {
  getOrMint(
    installationId: number,
    mint: () => Promise<GithubInstallationAccessToken>,
    scope?: GithubInstallationTokenScope | undefined,
  ): Promise<GithubInstallationAccessToken>;
}

export type InstallationTokenLockResult<T> = {acquired: true; value: T} | {acquired: false};

export interface InstallationTokenSecretStore {
  read(
    workspaceId: string,
    installationId: number,
    scopeKey?: string | undefined,
  ): Promise<string | null>;
  write(
    workspaceId: string,
    installationId: number,
    envelope: InstallationTokenEnvelope,
    scopeKey?: string | undefined,
  ): Promise<void>;
}

export interface SharedInstallationTokenCacheOptions {
  secretStore: InstallationTokenSecretStore;
  withLock: <T>(
    installationId: number,
    scopeKey: string | undefined,
    fn: () => Promise<T>,
  ) => Promise<InstallationTokenLockResult<T>>;
  resolveWorkspaceId: (installationId: number) => Promise<string>;
  now?: (() => Date) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  pollDelaysMs?: number[] | undefined;
  workspaceCacheTtlMs?: number | undefined;
  mintTimeoutMs?: number | undefined;
}

const DEFAULT_POLL_DELAYS_MS = [100, 200, 400, 500, 800];
const DEFAULT_WORKSPACE_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MINT_TIMEOUT_MS = 30 * 1000;

export class SharedInstallationTokenCache implements InstallationTokenCache {
  private readonly workspaceIds = new Map<number, {workspaceId: string; expiresAtMs: number}>();
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollDelaysMs: number[];
  private readonly workspaceCacheTtlMs: number;
  private readonly mintTimeoutMs: number;

  constructor(private readonly options: SharedInstallationTokenCacheOptions) {
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => sleepTimeout(ms).then(() => undefined));
    this.pollDelaysMs = options.pollDelaysMs ?? DEFAULT_POLL_DELAYS_MS;
    this.workspaceCacheTtlMs = options.workspaceCacheTtlMs ?? DEFAULT_WORKSPACE_CACHE_TTL_MS;
    this.mintTimeoutMs = options.mintTimeoutMs ?? DEFAULT_MINT_TIMEOUT_MS;
  }

  async getOrMint(
    installationId: number,
    mint: () => Promise<GithubInstallationAccessToken>,
    scope?: GithubInstallationTokenScope | undefined,
  ): Promise<GithubInstallationAccessToken> {
    const scopeKey = scope === undefined ? undefined : githubInstallationTokenScopeKey(scope);
    const workspaceId = await this.resolveWorkspaceId(installationId);
    const envelope = await this.readEnvelope(workspaceId, installationId, scopeKey);
    if (usable(envelope, this.now())) {
      recordInstallationTokenLookup('db-hit');
      return tokenFromEnvelope(envelope);
    }

    const result = await this.options.withLock(installationId, scopeKey, () =>
      this.mintUnderLock({workspaceId, installationId, scopeKey, mint}),
    );
    if (result.acquired) return result.value;

    return await this.serveStaleOrPoll({workspaceId, installationId, scopeKey, envelope});
  }

  private async mintUnderLock(params: {
    workspaceId: string;
    installationId: number;
    scopeKey: string | undefined;
    mint: () => Promise<GithubInstallationAccessToken>;
  }): Promise<GithubInstallationAccessToken> {
    const envelope = await this.readEnvelope(
      params.workspaceId,
      params.installationId,
      params.scopeKey,
    );
    const now = this.now();
    if (usable(envelope, now)) {
      recordInstallationTokenLookup('db-hit');
      return tokenFromEnvelope(envelope);
    }

    if (activeBackoff(envelope, now)) {
      if (canServeStale(envelope, now)) {
        recordInstallationTokenLookup('served-stale');
        return tokenFromEnvelope(envelope);
      }
      recordInstallationTokenLookup('backoff');
      throw providerErrorFromBackoff(
        envelope?.backoffReason ?? 'provider-unavailable',
        (envelope?.backoffUntil?.getTime() ?? now.getTime()) - now.getTime(),
        envelope?.backoffError,
      );
    }

    // A mint is authenticated as the GitHub App, so rate-limit and availability
    // backoffs are installation-wide even though envelopes are keyed per scope.
    // Consult the installation-wide envelope before a scoped mint so one scope's
    // 429/outage does not make every other scope retry the shared limit; the same
    // envelope is kept so a failed scoped mint can mirror its backoff onto it.
    let installationEnvelope: InstallationTokenEnvelope | undefined;
    if (params.scopeKey !== undefined) {
      installationEnvelope = await this.readEnvelope(
        params.workspaceId,
        params.installationId,
        undefined,
      );
      if (activeBackoff(installationEnvelope, now)) {
        recordInstallationTokenLookup('backoff');
        throw providerErrorFromBackoff(
          installationEnvelope?.backoffReason ?? 'provider-unavailable',
          (installationEnvelope?.backoffUntil?.getTime() ?? now.getTime()) - now.getTime(),
          installationEnvelope?.backoffError,
        );
      }
    }

    let token: GithubInstallationAccessToken;
    try {
      token = await this.recordMint(params.mint);
    } catch (error) {
      const providerError = toProviderError(error);
      const classified = classifyMintError(providerError);
      const until = new Date(this.now().getTime() + backoffMs(classified));
      recordInstallationTokenBackoff({reason: classified.reason, class: classified.class});

      await this.writeBackoffEnvelope({
        workspaceId: params.workspaceId,
        installationId: params.installationId,
        scopeKey: params.scopeKey,
        source: envelope,
        until,
        classified,
        providerError,
      });

      // Rate-limit, timeout, and availability failures reflect the shared GitHub
      // App rather than one repository, so mirror a transient scoped backoff onto
      // the installation-wide envelope: every other scope and the unscoped path
      // then respect the shared limit instead of retrying it. Repo-specific
      // (terminal) failures such as access-denied stay scoped.
      if (params.scopeKey !== undefined && classified.class === 'transient') {
        await this.writeBackoffEnvelope({
          workspaceId: params.workspaceId,
          installationId: params.installationId,
          scopeKey: undefined,
          source: installationEnvelope,
          until,
          classified,
          providerError,
        });
      }

      if (
        classified.class === 'transient' &&
        envelope?.token &&
        stillValid(envelope.expiresAt, this.now())
      ) {
        logger().warn(
          {
            installationId: params.installationId,
            workspaceId: params.workspaceId,
            scopeKey: params.scopeKey,
            expiresAt: envelope.expiresAt?.toISOString(),
            reason: classified.reason,
            backoffUntil: until.toISOString(),
          },
          'github installation token mint failed; serving stale token',
        );
        recordInstallationTokenLookup('served-stale');
        return tokenFromEnvelope(envelope);
      }

      logger().warn(
        {
          installationId: params.installationId,
          workspaceId: params.workspaceId,
          scopeKey: params.scopeKey,
          reason: classified.reason,
          backoffUntil: until.toISOString(),
          error: providerError,
        },
        'github installation token mint failed; backoff recorded',
      );
      recordInstallationTokenLookup('backoff');
      throw providerError;
    }

    try {
      await this.writeEnvelope(
        params.workspaceId,
        params.installationId,
        {
          token: token.token,
          expiresAt: token.expiresAt,
          permissions: token.permissions,
        },
        params.scopeKey,
      );
    } catch (error) {
      logger().warn(
        {
          installationId: params.installationId,
          workspaceId: params.workspaceId,
          scopeKey: params.scopeKey,
          expiresAt: token.expiresAt.toISOString(),
          error,
        },
        'github installation token cache write failed after mint',
      );
      reportError(error, {
        boundary: 'integration.cache',
        operation: 'write-minted-token',
        extra: {
          installationId: params.installationId,
          workspaceId: params.workspaceId,
          scopeKey: params.scopeKey,
        },
      });
    }

    logger().info(
      {
        installationId: params.installationId,
        workspaceId: params.workspaceId,
        scopeKey: params.scopeKey,
        expiresAt: token.expiresAt.toISOString(),
      },
      'github installation token minted',
    );
    recordInstallationTokenLookup('minted');
    return token;
  }

  private async writeBackoffEnvelope(params: {
    workspaceId: string;
    installationId: number;
    scopeKey: string | undefined;
    source: InstallationTokenEnvelope | undefined;
    until: Date;
    classified: ClassifiedMintError;
    providerError: GithubIntegrationProviderError;
  }): Promise<void> {
    await this.writeEnvelope(
      params.workspaceId,
      params.installationId,
      {
        token: params.source?.token,
        expiresAt: params.source?.expiresAt,
        permissions: params.source?.permissions,
        backoffUntil: params.until,
        backoffReason: params.classified.reason,
        backoffError: {
          message: params.providerError.message,
          ...(params.providerError.status === undefined
            ? {}
            : {status: params.providerError.status}),
        },
      },
      params.scopeKey,
    ).catch((writeError) => {
      logger().warn(
        {
          installationId: params.installationId,
          workspaceId: params.workspaceId,
          scopeKey: params.scopeKey,
          reason: params.classified.reason,
          error: writeError,
        },
        'github installation token backoff write failed',
      );
      reportError(writeError, {
        boundary: 'integration.cache',
        operation: 'write-backoff-envelope',
        extra: {
          installationId: params.installationId,
          workspaceId: params.workspaceId,
          scopeKey: params.scopeKey,
        },
      });
    });
  }

  private async serveStaleOrPoll(params: {
    workspaceId: string;
    installationId: number;
    scopeKey: string | undefined;
    envelope: InstallationTokenEnvelope | undefined;
  }): Promise<GithubInstallationAccessToken> {
    const initialNow = this.now();
    if (canServeStale(params.envelope, initialNow)) {
      recordInstallationTokenLookup('served-stale');
      return tokenFromEnvelope(params.envelope);
    }
    if (activeBackoff(params.envelope, initialNow)) {
      recordInstallationTokenLookup('backoff');
      throw providerErrorFromBackoff(
        params.envelope.backoffReason,
        params.envelope.backoffUntil.getTime() - initialNow.getTime(),
        params.envelope.backoffError,
      );
    }

    for (const delayMs of this.pollDelaysMs) {
      await this.sleep(delayMs);
      const envelope = await this.readEnvelope(
        params.workspaceId,
        params.installationId,
        params.scopeKey,
      );
      const now = this.now();
      if (usable(envelope, now)) {
        recordInstallationTokenLookup('contended-poll');
        return tokenFromEnvelope(envelope);
      }
      if (backoffActive(envelope, now)) {
        recordInstallationTokenLookup('backoff');
        throw providerErrorFromBackoff(
          envelope?.backoffReason ?? 'provider-unavailable',
          (envelope?.backoffUntil?.getTime() ?? now.getTime()) - now.getTime(),
          envelope?.backoffError,
        );
      }
    }

    throw new GithubIntegrationProviderError(
      'provider-unavailable',
      'GitHub installation token mint is still in progress',
      1,
    );
  }

  private async recordMint(
    mint: () => Promise<GithubInstallationAccessToken>,
  ): Promise<GithubInstallationAccessToken> {
    const startedAt = Date.now();
    try {
      const token = await withTimeout(mint(), this.mintTimeoutMs);
      recordInstallationTokenMint({outcome: 'success', durationMs: Date.now() - startedAt});
      return token;
    } catch (error) {
      recordInstallationTokenMint({outcome: 'failure', durationMs: Date.now() - startedAt});
      throw error;
    }
  }

  private async readEnvelope(
    workspaceId: string,
    installationId: number,
    scopeKey: string | undefined,
  ): Promise<InstallationTokenEnvelope | undefined> {
    const raw = await this.options.secretStore.read(workspaceId, installationId, scopeKey);
    if (raw === null) return undefined;

    const envelope = parseInstallationTokenEnvelope(raw);
    if (envelope === undefined) {
      logger().warn(
        {installationId, workspaceId, scopeKey},
        'github installation token cache envelope failed to decode',
      );
      return undefined;
    }
    if (envelope.scopeKey !== scopeKey) {
      // The secret-store contract is implemented in a separate package; if a store
      // ignores the scopeKey argument (older core release or a custom store), an
      // envelope written for one scope could be served for another. Never serve an
      // envelope whose recorded scope does not match the requested namespace.
      logger().warn(
        {
          installationId,
          workspaceId,
          requestedScopeKey: scopeKey,
          recordedScopeKey: envelope.scopeKey,
        },
        'github installation token cache envelope recorded for a different scope; treating as a miss',
      );
      return undefined;
    }
    return envelope;
  }

  private async writeEnvelope(
    workspaceId: string,
    installationId: number,
    envelope: InstallationTokenEnvelope,
    scopeKey: string | undefined,
  ): Promise<void> {
    await this.options.secretStore.write(
      workspaceId,
      installationId,
      {
        ...envelope,
        ...(scopeKey === undefined ? {} : {scopeKey}),
      },
      scopeKey,
    );
  }

  private async resolveWorkspaceId(installationId: number): Promise<string> {
    const nowMs = this.now().getTime();
    const cached = this.workspaceIds.get(installationId);
    if (cached && cached.expiresAtMs > nowMs) return cached.workspaceId;

    const workspaceId = await this.options.resolveWorkspaceId(installationId);
    this.workspaceIds.set(installationId, {
      workspaceId,
      expiresAtMs: nowMs + this.workspaceCacheTtlMs,
    });
    return workspaceId;
  }
}

type ActiveBackoffEnvelope = InstallationTokenEnvelope & {
  backoffUntil: Date;
  backoffReason: NonNullable<InstallationTokenEnvelope['backoffReason']>;
};

type TokenEnvelope = InstallationTokenEnvelope & {token: string; expiresAt: Date};

function activeBackoff(
  envelope: InstallationTokenEnvelope | undefined,
  now: Date,
): envelope is ActiveBackoffEnvelope {
  return (
    backoffActive(envelope, now) &&
    envelope?.backoffUntil !== undefined &&
    envelope.backoffReason !== undefined
  );
}

function canServeStale(
  envelope: InstallationTokenEnvelope | undefined,
  now: Date,
): envelope is TokenEnvelope {
  const terminalBackoff =
    activeBackoff(envelope, now) && mintErrorClassForReason(envelope.backoffReason) === 'terminal';
  return (
    envelope?.token !== undefined &&
    envelope.expiresAt !== undefined &&
    stillValid(envelope.expiresAt, now) &&
    !terminalBackoff
  );
}

function tokenFromEnvelope(envelope: InstallationTokenEnvelope): GithubInstallationAccessToken {
  if (!envelope.token || !envelope.expiresAt) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub installation token cache envelope is missing a token or expiry',
    );
  }
  return {
    token: envelope.token,
    expiresAt: envelope.expiresAt,
    ...(envelope.permissions === undefined ? {} : {permissions: envelope.permissions}),
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new GithubIntegrationProviderError(
          'timeout',
          'Timed out minting GitHub installation access token',
        ),
      );
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
