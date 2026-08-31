import {createHash, randomUUID} from 'node:crypto';
import {setTimeout as sleepTimeout} from 'node:timers/promises';
import type {IntegrationProviderErrorReason} from '@shipfox/api-integration-spi';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {GithubIntegrationProviderError} from '#core/errors.js';
import {withGithubCheckoutTokenLock} from '#db/checkout-token-lock.js';
import {recordGithubCheckoutTokenLookup, recordGithubCheckoutTokenMint} from '#metrics/instance.js';
import type {GithubInstallationAccessToken} from './client.js';
import {
  backoffMs,
  classifyMintError,
  mintErrorClassForReason,
  providerErrorFromBackoff,
  toProviderError,
} from './installation-token-envelope.js';

export const GITHUB_CHECKOUT_TOKEN_CACHE_VERSION = 1;
export const GITHUB_CHECKOUT_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
export const GITHUB_CHECKOUT_TOKEN_STALE_MINIMUM_MS = 60 * 1000;
export const GITHUB_CHECKOUT_TOKEN_REJECTION_GUARD_MS = 30 * 1000;
export const GITHUB_CHECKOUT_TOKEN_RETENTION_MS = 24 * 60 * 60 * 1000;

const DEFAULT_MAX_RAM_ENTRIES = 1_000;
const DEFAULT_POLL_DELAYS_MS = [100, 200, 400, 800, 1_600, 3_200, 6_400, 12_800, 4_500];
const DEFAULT_MINT_TIMEOUT_MS = 30_000;
const STORAGE_KEY_PREFIX = `v${GITHUB_CHECKOUT_TOKEN_CACHE_VERSION}-`;
const BASELINE_PERMISSION_KEYS = new Set(['metadata']);
const PROVIDER_ERROR_REASONS = new Set<IntegrationProviderErrorReason>([
  'repository-not-found',
  'installation-not-found',
  'file-not-found',
  'access-denied',
  'rate-limited',
  'timeout',
  'provider-unavailable',
  'provider-rejected',
  'malformed-provider-response',
  'content-too-large',
  'too-many-files',
]);
const TRAILING_SLASHES_RE = /\/+$/u;

type Permission = 'read' | 'write';
export type GithubCheckoutTokenPermissions = Readonly<Record<string, Permission>>;

export interface GithubCheckoutTokenScope {
  workspaceId: string;
  /** A stable fingerprint of the normalized GitHub API origin and App id. */
  providerInstance: string;
  installationId: number;
  repositoryId: number;
  permissions: GithubCheckoutTokenPermissions;
}

export interface GithubCheckoutTokenEnvelope {
  version: typeof GITHUB_CHECKOUT_TOKEN_CACHE_VERSION;
  generation?: string | undefined;
  token?: string | undefined;
  expiresAt?: Date | undefined;
  repositoryId: number;
  permissions: Record<string, Permission>;
  backoffUntil?: Date | undefined;
  backoffReason?: IntegrationProviderErrorReason | undefined;
  backoffError?: {message: string; status?: number | undefined} | undefined;
  rejectionRefreshNotBefore?: Date | undefined;
}

export interface GithubCheckoutToken {
  token: string;
  expiresAt: Date;
  generation: string;
  stale?: boolean | undefined;
}

export type GithubCheckoutTokenLockResult<T> = {acquired: true; value: T} | {acquired: false};

export interface GithubCheckoutTokenSecretStore {
  read(params: {workspaceId: string; namespace: string; key: string}): Promise<string | null>;
  write(params: {
    workspaceId: string;
    namespace: string;
    key: string;
    value: string;
  }): Promise<void>;
  delete?(params: {workspaceId: string; namespace: string; key: string}): Promise<void>;
  list?(params: {workspaceId: string; namespace: string}): Promise<Record<string, string>>;
  deleteNamespace?(params: {workspaceId: string; namespace: string}): Promise<number>;
}

export interface GithubCheckoutTokenCachePort {
  getOrMint(
    scope: GithubCheckoutTokenScope,
    mint: () => Promise<GithubInstallationAccessToken>,
    rejectedGeneration?: string,
  ): Promise<GithubCheckoutToken>;
}

export interface GithubCheckoutTokenCacheOptions {
  secretStore?: GithubCheckoutTokenSecretStore | undefined;
  withLock?: <T>(
    scopeDigest: string,
    fn: () => Promise<T>,
  ) => Promise<GithubCheckoutTokenLockResult<T>>;
  now?: (() => Date) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  pollDelaysMs?: number[] | undefined;
  mintTimeoutMs?: number | undefined;
  maxRamEntries?: number | undefined;
}

export function canonicalGithubCheckoutTokenScope(scope: GithubCheckoutTokenScope): string {
  const normalized = normalizeScope(scope);
  return JSON.stringify({
    version: GITHUB_CHECKOUT_TOKEN_CACHE_VERSION,
    workspaceId: normalized.workspaceId,
    providerInstance: normalized.providerInstance,
    installationId: normalized.installationId,
    repositoryId: normalized.repositoryId,
    permissions: normalized.permissions,
  });
}

export function githubCheckoutTokenScopeDigest(scope: GithubCheckoutTokenScope): string {
  return createHash('sha256')
    .update(canonicalGithubCheckoutTokenScope(scope), 'utf8')
    .digest('hex');
}

export function githubCheckoutTokenStorageKey(scope: GithubCheckoutTokenScope): string {
  return `${STORAGE_KEY_PREFIX}${githubCheckoutTokenScopeDigest(scope)}`;
}

export function deleteGithubCheckoutTokenSecretGroup(params: {
  workspaceId: string;
  providerInstance: string;
  installationId: number;
  deleteSecrets: (params: {workspaceId: string; namespace: string}) => Promise<number>;
}): Promise<number> {
  return params.deleteSecrets({
    workspaceId: params.workspaceId,
    namespace: githubCheckoutTokenNamespace(params.providerInstance, params.installationId),
  });
}

export function githubCheckoutTokenNamespace(
  providerInstance: string,
  installationId: number,
): string {
  if (!providerInstance || !Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new Error(
      `Invalid GitHub provider instance or installation id for checkout-token namespace: ${providerInstance}/${installationId}`,
    );
  }
  return `system/github/checkout-token/${providerInstance}/${installationId}`;
}

export function githubProviderInstanceFingerprint(apiOrigin: string, appId: string): string {
  const normalizedOrigin = normalizeGithubApiOrigin(apiOrigin);
  const normalizedAppId = appId.trim();
  if (!normalizedOrigin || !normalizedAppId)
    throw new Error('GitHub provider instance identity is incomplete');
  return createHash('sha256')
    .update(
      `github-provider-instance:v${GITHUB_CHECKOUT_TOKEN_CACHE_VERSION}\0${normalizedOrigin}\0${normalizedAppId}`,
    )
    .digest('hex');
}

function normalizeGithubApiOrigin(apiOrigin: string): string {
  const parsed = new URL(apiOrigin);
  const defaultPort =
    (parsed.protocol === 'https:' && parsed.port === '443') ||
    (parsed.protocol === 'http:' && parsed.port === '80');
  const port = parsed.port && !defaultPort ? `:${parsed.port}` : '';
  const pathname = parsed.pathname.replace(TRAILING_SLASHES_RE, '');
  return `${parsed.protocol.toLowerCase()}//${parsed.hostname.toLowerCase()}${port}${pathname}`;
}

export function encodeGithubCheckoutTokenEnvelope(envelope: GithubCheckoutTokenEnvelope): string {
  return JSON.stringify({
    version: envelope.version,
    ...(envelope.generation === undefined ? {} : {generation: envelope.generation}),
    ...(envelope.token === undefined ? {} : {token: envelope.token}),
    ...(envelope.expiresAt === undefined ? {} : {expiresAt: envelope.expiresAt.toISOString()}),
    repositoryId: envelope.repositoryId,
    permissions: envelope.permissions,
    ...(envelope.backoffUntil === undefined
      ? {}
      : {backoffUntil: envelope.backoffUntil.toISOString()}),
    ...(envelope.backoffReason === undefined ? {} : {backoffReason: envelope.backoffReason}),
    ...(envelope.backoffError === undefined ? {} : {backoffError: envelope.backoffError}),
    ...(envelope.rejectionRefreshNotBefore === undefined
      ? {}
      : {rejectionRefreshNotBefore: envelope.rejectionRefreshNotBefore.toISOString()}),
  });
}

export function parseGithubCheckoutTokenEnvelope(
  raw: string,
): GithubCheckoutTokenEnvelope | undefined {
  const value = parseJsonRecord(raw);
  if (!value || !isValidEnvelopeShape(value)) return undefined;
  const dates = parseEnvelopeDates(value);
  if (!dates) return undefined;

  return {
    version: GITHUB_CHECKOUT_TOKEN_CACHE_VERSION,
    ...(value.generation === undefined ? {} : {generation: value.generation}),
    ...(value.token === undefined ? {} : {token: value.token}),
    ...(dates.expiresAt === undefined ? {} : {expiresAt: dates.expiresAt}),
    repositoryId: value.repositoryId,
    permissions: value.permissions,
    ...(dates.backoffUntil === undefined ? {} : {backoffUntil: dates.backoffUntil}),
    ...(value.backoffReason === undefined
      ? {}
      : {backoffReason: value.backoffReason as IntegrationProviderErrorReason}),
    ...(value.backoffError === undefined ? {} : {backoffError: value.backoffError}),
    ...(dates.rejectionRefreshNotBefore === undefined
      ? {}
      : {rejectionRefreshNotBefore: dates.rejectionRefreshNotBefore}),
  };
}

/**
 * Exact-scope L2 cache. The shared store is expected to encrypt values; this
 * class deliberately treats it as an opaque secret boundary.
 */
export class GithubCheckoutTokenCache implements GithubCheckoutTokenCachePort {
  private readonly ram = new Map<string, RamEntry>();
  private readonly inFlight = new Map<string, Promise<GithubCheckoutToken>>();
  private readonly inFlightScopes = new Map<string, GithubCheckoutTokenScope>();
  private readonly lateMints = new Map<string, Set<Promise<void>>>();
  private readonly deleting = new Map<string, Promise<number>>();
  // A completed deletion remains observable to late mints as an epoch tombstone.
  private readonly deletionEpochs = new Map<string, number>();
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollDelaysMs: number[];
  private readonly mintTimeoutMs: number;
  private readonly maxRamEntries: number;

  constructor(private readonly options: GithubCheckoutTokenCacheOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => sleepTimeout(ms).then(() => undefined));
    this.pollDelaysMs = options.pollDelaysMs ?? DEFAULT_POLL_DELAYS_MS;
    this.mintTimeoutMs = options.mintTimeoutMs ?? DEFAULT_MINT_TIMEOUT_MS;
    this.maxRamEntries = options.maxRamEntries ?? DEFAULT_MAX_RAM_ENTRIES;
    if (!Number.isSafeInteger(this.maxRamEntries) || this.maxRamEntries < 1) {
      throw new Error(`Invalid GitHub checkout-token RAM capacity: ${this.maxRamEntries}`);
    }
  }

  async getOrMint(
    scope: GithubCheckoutTokenScope,
    mint: () => Promise<GithubInstallationAccessToken>,
    rejectedGeneration?: string,
  ): Promise<GithubCheckoutToken> {
    const normalizedScope = normalizeScope(scope);
    const namespace = githubCheckoutTokenNamespace(
      normalizedScope.providerInstance,
      normalizedScope.installationId,
    );
    const stateKey = githubCheckoutTokenStateKey(normalizedScope.workspaceId, namespace);
    const deletion = this.deleting.get(stateKey);
    if (deletion) {
      await deletion;
      return await this.getOrMint(scope, mint, rejectedGeneration);
    }
    const digest = githubCheckoutTokenScopeDigest(normalizedScope);
    const ramEnvelope = this.readRam(digest, this.now());
    if (shouldRejectForGuard(ramEnvelope, rejectedGeneration, this.now())) {
      recordGithubCheckoutTokenLookup('rejection-guard');
      throw rejectionGuardError();
    }
    if (ramEnvelope && canReturn(ramEnvelope, normalizedScope, this.now(), rejectedGeneration)) {
      recordGithubCheckoutTokenLookup('ram-hit');
      return tokenFromEnvelope(ramEnvelope);
    }

    let current = ramEnvelope;
    let loadedShared = false;
    if (this.options.secretStore) {
      const shared = await this.readShared(normalizedScope);
      if (shared) {
        current = shared;
        loadedShared = true;
        this.writeRam(digest, normalizedScope, shared);
      }
    }

    if (current && canReturn(current, normalizedScope, this.now(), rejectedGeneration)) {
      recordGithubCheckoutTokenLookup(loadedShared ? 'shared-hit' : 'ram-hit');
      return tokenFromEnvelope(current);
    }

    const deletionAfterRead = this.deleting.get(stateKey);
    if (deletionAfterRead) {
      await deletionAfterRead;
      return await this.getOrMint(scope, mint, rejectedGeneration);
    }

    const pending = this.inFlight.get(digest);
    if (pending) {
      return await this.resolvePending(digest, pending, normalizedScope, mint, rejectedGeneration);
    }

    const operation = this.getOrMintOutsideFlight(
      normalizedScope,
      digest,
      mint,
      rejectedGeneration,
      current,
    ).finally(() => {
      if (this.inFlight.get(digest) === operation) {
        this.inFlight.delete(digest);
        this.inFlightScopes.delete(digest);
      }
    });
    this.inFlight.set(digest, operation);
    this.inFlightScopes.set(digest, normalizedScope);
    return operation;
  }

  private async resolvePending(
    digest: string,
    pending: Promise<GithubCheckoutToken>,
    scope: GithubCheckoutTokenScope,
    mint: () => Promise<GithubInstallationAccessToken>,
    rejectedGeneration: string | undefined,
  ): Promise<GithubCheckoutToken> {
    const result = await pending;
    if (rejectedGeneration === undefined || result.generation !== rejectedGeneration) {
      return result;
    }
    if (this.inFlight.get(digest) === pending) this.inFlight.delete(digest);
    return await this.getOrMint(scope, mint, rejectedGeneration);
  }

  async deleteInstallation(
    workspaceId: string,
    providerInstance: string,
    installationId: number,
  ): Promise<number> {
    const namespace = githubCheckoutTokenNamespace(providerInstance, installationId);
    const stateKey = githubCheckoutTokenStateKey(workspaceId, namespace);
    this.deletionEpochs.set(stateKey, (this.deletionEpochs.get(stateKey) ?? 0) + 1);
    const deletion = Promise.resolve().then(async () => {
      await Promise.all(
        [...this.inFlight.entries()]
          .filter(([digest]) => {
            const scope = this.inFlightScopes.get(digest);
            return (
              scope?.workspaceId === workspaceId &&
              scope.providerInstance === providerInstance &&
              scope.installationId === installationId
            );
          })
          .map(([, pending]) => pending.catch(() => undefined)),
      );
      // Late provider promises cannot be cancelled. The epoch tombstone above
      // prevents a later completion from repopulating this installation.
      for (const [digest, entry] of this.ram) {
        if (
          entry.scope.workspaceId === workspaceId &&
          entry.scope.providerInstance === providerInstance &&
          entry.scope.installationId === installationId
        ) {
          this.ram.delete(digest);
        }
      }
      const store = this.options.secretStore;
      if (store?.deleteNamespace) {
        return await store.deleteNamespace({workspaceId, namespace});
      }
      if (!store?.list || !store.delete) return 0;
      const values = await store.list({workspaceId, namespace});
      await Promise.all(
        Object.keys(values).map((key) => store.delete?.({workspaceId, namespace, key})),
      );
      return Object.keys(values).length;
    });
    this.deleting.set(stateKey, deletion);
    try {
      return await deletion;
    } finally {
      if (this.deleting.get(stateKey) === deletion) this.deleting.delete(stateKey);
    }
  }

  /** Deletes expired entries in one bounded namespace pass. */
  async cleanupExpired(scope: GithubCheckoutTokenScope, limit = 100): Promise<number> {
    const store = this.options.secretStore;
    if (!store?.list || !store.delete) return 0;
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error(`Invalid cleanup limit: ${limit}`);

    const normalizedScope = normalizeScope(scope);
    const namespace = githubCheckoutTokenNamespace(
      normalizedScope.providerInstance,
      normalizedScope.installationId,
    );
    const values = await store.list({
      workspaceId: normalizedScope.workspaceId,
      namespace,
    });
    let deleted = 0;
    const now = this.now();
    for (const [key, raw] of Object.entries(values)) {
      if (deleted >= limit) break;
      if (!key.startsWith(STORAGE_KEY_PREFIX)) continue;
      const envelope = parseGithubCheckoutTokenEnvelope(raw);
      if (!envelope || !isExpiredForCleanup(envelope, now)) continue;
      await store.delete({
        workspaceId: normalizedScope.workspaceId,
        namespace,
        key,
      });
      deleted += 1;
    }
    return deleted;
  }

  private async getOrMintOutsideFlight(
    scope: GithubCheckoutTokenScope,
    digest: string,
    mint: () => Promise<GithubInstallationAccessToken>,
    rejectedGeneration: string | undefined,
    initial: GithubCheckoutTokenEnvelope | undefined,
  ): Promise<GithubCheckoutToken> {
    const withLock =
      this.options.withLock ??
      (async <T>(scopeDigest: string, fn: () => Promise<T>) =>
        await withGithubCheckoutTokenLock(scopeDigest, fn));
    const result = await withLock(digest, () =>
      this.mintUnderLock(scope, digest, mint, rejectedGeneration),
    );
    if (result.acquired) return result.value;

    if (initial && !rejectedGeneration && canServeStale(initial, this.now())) {
      recordGithubCheckoutTokenLookup('served-stale');
      return tokenFromEnvelope(initial, true);
    }
    return await this.pollAfterContention(scope, digest, rejectedGeneration);
  }

  private async mintUnderLock(
    scope: GithubCheckoutTokenScope,
    digest: string,
    mint: () => Promise<GithubInstallationAccessToken>,
    rejectedGeneration: string | undefined,
  ): Promise<GithubCheckoutToken> {
    const current = this.options.secretStore
      ? await this.readShared(scope)
      : this.readRam(digest, this.now());
    const now = this.now();

    if (current && canReturn(current, scope, now, rejectedGeneration)) {
      recordGithubCheckoutTokenLookup(this.options.secretStore ? 'shared-hit' : 'ram-hit');
      this.writeRam(digest, scope, current);
      return tokenFromEnvelope(current);
    }
    if (shouldRejectForGuard(current, rejectedGeneration, now)) {
      recordGithubCheckoutTokenLookup('rejection-guard');
      throw rejectionGuardError();
    }

    const staleOrBackoff = staleOrBackoffResult(current, now, rejectedGeneration);
    if (staleOrBackoff) return staleOrBackoff;

    let minted: GithubInstallationAccessToken;
    try {
      minted = await this.mintToken(scope, digest, current, mint, now);
    } catch (error) {
      const providerError = toProviderError(error);
      if (
        !rejectedGeneration &&
        current !== undefined &&
        classifyMintError(providerError).class === 'transient' &&
        canServeStale(current, now)
      ) {
        recordGithubCheckoutTokenLookup('served-stale');
        return tokenFromEnvelope(current, true);
      }
      throw error;
    }
    const generation = newGeneration(rejectedGeneration);
    const rejectionRefreshNotBefore = rejectedGeneration
      ? new Date(now.getTime() + GITHUB_CHECKOUT_TOKEN_REJECTION_GUARD_MS)
      : undefined;
    const envelope: GithubCheckoutTokenEnvelope = {
      version: GITHUB_CHECKOUT_TOKEN_CACHE_VERSION,
      generation,
      token: minted.token,
      expiresAt: minted.expiresAt,
      repositoryId: scope.repositoryId,
      permissions: {...scope.permissions},
      ...(rejectionRefreshNotBefore === undefined ? {} : {rejectionRefreshNotBefore}),
    };
    await this.writeShared(scope, envelope);
    this.writeRam(digest, scope, envelope);
    recordGithubCheckoutTokenLookup('minted');
    return tokenFromEnvelope(envelope);
  }

  private async mintToken(
    scope: GithubCheckoutTokenScope,
    digest: string,
    current: GithubCheckoutTokenEnvelope | undefined,
    mint: () => Promise<GithubInstallationAccessToken>,
    now: Date,
  ): Promise<GithubInstallationAccessToken> {
    const mintStartedAt = Date.now();
    const namespace = githubCheckoutTokenNamespace(scope.providerInstance, scope.installationId);
    const stateKey = githubCheckoutTokenStateKey(scope.workspaceId, namespace);
    const deletionEpoch = this.deletionEpochs.get(stateKey) ?? 0;
    try {
      const minted = await withTimeout(
        mint(),
        this.mintTimeoutMs,
        (lateMint) => this.persistLateMint(scope, digest, current, lateMint, now, deletionEpoch),
        (lateWork) => this.trackLateMint(scope, lateWork),
      );
      validateMintedToken(scope, minted, now);
      recordGithubCheckoutTokenMint({outcome: 'success', durationMs: Date.now() - mintStartedAt});
      return minted;
    } catch (error) {
      recordGithubCheckoutTokenMint({outcome: 'failure', durationMs: Date.now() - mintStartedAt});
      const providerError = toProviderError(error);
      const classified = classifyMintError(providerError);
      const backoffEnvelope: GithubCheckoutTokenEnvelope = {
        version: GITHUB_CHECKOUT_TOKEN_CACHE_VERSION,
        repositoryId: scope.repositoryId,
        permissions: {...scope.permissions},
        ...(current?.generation === undefined ? {} : {generation: current.generation}),
        ...(current?.token === undefined ? {} : {token: current.token}),
        ...(current?.expiresAt === undefined ? {} : {expiresAt: current.expiresAt}),
        backoffUntil: new Date(now.getTime() + backoffMs(classified)),
        backoffReason: classified.reason,
        backoffError: {
          message: providerError.message,
          ...(providerError.status === undefined ? {} : {status: providerError.status}),
        },
      };
      await this.writeShared(scope, backoffEnvelope);
      this.writeRam(digest, scope, backoffEnvelope);
      recordGithubCheckoutTokenLookup('failed');
      throw providerError;
    }
  }

  private async persistLateMint(
    scope: GithubCheckoutTokenScope,
    digest: string,
    previous: GithubCheckoutTokenEnvelope | undefined,
    minted: GithubInstallationAccessToken,
    now: Date,
    deletionEpoch: number,
  ): Promise<void> {
    const namespace = githubCheckoutTokenNamespace(scope.providerInstance, scope.installationId);
    const stateKey = githubCheckoutTokenStateKey(scope.workspaceId, namespace);
    if (this.deleting.has(stateKey)) return;
    if ((this.deletionEpochs.get(stateKey) ?? 0) !== deletionEpoch) return;
    try {
      validateMintedToken(scope, minted, now);
      const current = this.options.secretStore
        ? await this.readShared(scope)
        : this.readRam(digest, this.now());
      const sameGeneration =
        previous?.generation === undefined
          ? current?.generation === undefined && current?.token === undefined
          : current?.generation === previous.generation && current.token === previous.token;
      if (
        !sameGeneration ||
        this.deleting.has(stateKey) ||
        (this.deletionEpochs.get(stateKey) ?? 0) !== deletionEpoch
      )
        return;

      const envelope: GithubCheckoutTokenEnvelope = {
        version: GITHUB_CHECKOUT_TOKEN_CACHE_VERSION,
        generation: newGeneration(previous?.generation),
        token: minted.token,
        expiresAt: minted.expiresAt,
        repositoryId: scope.repositoryId,
        permissions: {...scope.permissions},
      };
      if (this.deleting.has(stateKey) || (this.deletionEpochs.get(stateKey) ?? 0) !== deletionEpoch)
        return;
      await this.writeShared(scope, envelope);
      this.writeRam(digest, scope, envelope);
    } catch (error) {
      logger().warn(
        {scopeDigest: githubCheckoutTokenScopeDigest(scope), error},
        'Late GitHub checkout token mint could not be cached',
      );
      reportError(error, {
        boundary: 'integration.cache',
        operation: 'write-late-checkout-envelope',
      });
    }
  }

  private trackLateMint(scope: GithubCheckoutTokenScope, work: Promise<void>): void {
    const namespace = githubCheckoutTokenNamespace(scope.providerInstance, scope.installationId);
    const stateKey = githubCheckoutTokenStateKey(scope.workspaceId, namespace);
    const boundedWork = boundLateWork(work, this.mintTimeoutMs);
    const pending = this.lateMints.get(stateKey) ?? new Set<Promise<void>>();
    pending.add(boundedWork);
    this.lateMints.set(stateKey, pending);
    const remove = () => {
      if (pending.delete(boundedWork) && pending.size === 0) this.lateMints.delete(stateKey);
    };
    void boundedWork.then(remove, remove);
  }

  private async pollAfterContention(
    scope: GithubCheckoutTokenScope,
    digest: string,
    rejectedGeneration: string | undefined,
  ): Promise<GithubCheckoutToken> {
    let elapsedMs = 0;
    for (const configuredDelayMs of this.pollDelaysMs) {
      if (elapsedMs >= this.mintTimeoutMs) break;
      const delayMs = Math.min(configuredDelayMs, this.mintTimeoutMs - elapsedMs);
      elapsedMs += delayMs;
      await this.sleep(delayMs);
      const envelope = this.options.secretStore
        ? await this.readShared(scope)
        : this.readRam(digest, this.now());
      const now = this.now();
      if (!envelope) continue;
      if (shouldRejectForGuard(envelope, rejectedGeneration, now)) throw rejectionGuardError();
      if (canReturn(envelope, scope, now, rejectedGeneration)) {
        this.writeRam(digest, scope, envelope);
        return tokenFromEnvelope(envelope);
      }
      if (activeBackoff(envelope, now)) {
        throw providerErrorFromBackoff(
          envelope.backoffReason as IntegrationProviderErrorReason,
          envelope.backoffUntil.getTime() - now.getTime(),
          envelope.backoffError,
        );
      }
    }
    throw new GithubIntegrationProviderError(
      'provider-unavailable',
      'GitHub checkout token mint is still in progress',
      1,
    );
  }

  private readRam(digest: string, now: Date): GithubCheckoutTokenEnvelope | undefined {
    const entry = this.ram.get(digest);
    if (!entry) return undefined;
    if (isUnusable(entry.envelope, now)) {
      this.ram.delete(digest);
      return undefined;
    }
    entry.lastUsedAt = now.getTime();
    this.ram.delete(digest);
    this.ram.set(digest, entry);
    return entry.envelope;
  }

  private writeRam(
    digest: string,
    scope: GithubCheckoutTokenScope,
    envelope: GithubCheckoutTokenEnvelope,
  ): void {
    this.ram.delete(digest);
    this.ram.set(digest, {
      envelope,
      scope,
      lastUsedAt: this.now().getTime(),
    });
    while (this.ram.size > this.maxRamEntries) {
      const oldest = this.ram.keys().next().value;
      if (oldest === undefined) break;
      this.ram.delete(oldest);
    }
  }

  private async readShared(
    scope: GithubCheckoutTokenScope,
  ): Promise<GithubCheckoutTokenEnvelope | undefined> {
    const store = this.options.secretStore;
    if (!store) return undefined;
    try {
      const raw = await store.read({
        workspaceId: scope.workspaceId,
        namespace: githubCheckoutTokenNamespace(scope.providerInstance, scope.installationId),
        key: githubCheckoutTokenStorageKey(scope),
      });
      if (raw === null) return undefined;
      const envelope = parseGithubCheckoutTokenEnvelope(raw);
      if (!envelope || !sameScope(envelope, scope)) {
        logger().warn(
          {scopeDigest: githubCheckoutTokenScopeDigest(scope)},
          'GitHub checkout token cache envelope failed exact-scope validation',
        );
        return undefined;
      }
      return envelope;
    } catch (error) {
      logger().warn(
        {scopeDigest: githubCheckoutTokenScopeDigest(scope), error},
        'GitHub checkout token cache read failed',
      );
      reportError(error, {boundary: 'integration.cache', operation: 'read-checkout-envelope'});
      return undefined;
    }
  }

  private async writeShared(
    scope: GithubCheckoutTokenScope,
    envelope: GithubCheckoutTokenEnvelope,
  ): Promise<void> {
    const store = this.options.secretStore;
    if (!store) return;
    try {
      await store.write({
        workspaceId: scope.workspaceId,
        namespace: githubCheckoutTokenNamespace(scope.providerInstance, scope.installationId),
        key: githubCheckoutTokenStorageKey(scope),
        value: encodeGithubCheckoutTokenEnvelope(envelope),
      });
    } catch (error) {
      logger().warn(
        {scopeDigest: githubCheckoutTokenScopeDigest(scope), error},
        'GitHub checkout token cache write failed',
      );
      reportError(error, {boundary: 'integration.cache', operation: 'write-checkout-envelope'});
    }
  }
}

interface RamEntry {
  envelope: GithubCheckoutTokenEnvelope;
  scope: GithubCheckoutTokenScope;
  lastUsedAt: number;
}

function githubCheckoutTokenStateKey(workspaceId: string, namespace: string): string {
  return `${workspaceId}\u0000${namespace}`;
}

function boundLateWork(work: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  return Promise.race([work.catch(() => undefined), deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function normalizeScope(scope: GithubCheckoutTokenScope): GithubCheckoutTokenScope {
  if (!scope.workspaceId || !scope.providerInstance) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub checkout token scope is missing its workspace or provider instance',
    );
  }
  if (!isPositiveInteger(scope.installationId) || !isPositiveInteger(scope.repositoryId)) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub checkout token scope must name one installation and repository',
    );
  }
  if (!isPermissions(scope.permissions) || Object.keys(scope.permissions).length === 0) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub checkout token scope has invalid permissions',
    );
  }
  const permissions = Object.fromEntries(
    Object.entries(scope.permissions).sort(([first], [second]) => first.localeCompare(second)),
  ) as Record<string, Permission>;
  return {...scope, permissions};
}

function sameScope(
  envelope: GithubCheckoutTokenEnvelope,
  scope: GithubCheckoutTokenScope,
): boolean {
  return (
    envelope.repositoryId === scope.repositoryId &&
    JSON.stringify(envelope.permissions) === JSON.stringify(scope.permissions)
  );
}

function canReturn(
  envelope: GithubCheckoutTokenEnvelope,
  scope: GithubCheckoutTokenScope,
  now: Date,
  rejectedGeneration: string | undefined,
): boolean {
  if (
    !sameScope(envelope, scope) ||
    !envelope.token ||
    !envelope.expiresAt ||
    !envelope.generation
  ) {
    return false;
  }
  if (rejectedGeneration !== undefined && envelope.generation === rejectedGeneration) return false;
  return envelope.expiresAt.getTime() > now.getTime() + GITHUB_CHECKOUT_TOKEN_REFRESH_MARGIN_MS;
}

function staleOrBackoffResult(
  envelope: GithubCheckoutTokenEnvelope | undefined,
  now: Date,
  rejectedGeneration: string | undefined,
): GithubCheckoutToken | undefined {
  if (!envelope || !activeBackoff(envelope, now)) return undefined;
  if (!rejectedGeneration && canServeStale(envelope, now)) {
    recordGithubCheckoutTokenLookup('served-stale');
    return tokenFromEnvelope(envelope, true);
  }
  recordGithubCheckoutTokenLookup('backoff');
  throw providerErrorFromBackoff(
    envelope.backoffReason,
    envelope.backoffUntil.getTime() - now.getTime(),
    envelope.backoffError,
  );
}

function canServeStale(envelope: GithubCheckoutTokenEnvelope | undefined, now: Date): boolean {
  return Boolean(
    envelope?.token &&
      envelope.generation &&
      envelope.expiresAt &&
      envelope.expiresAt.getTime() > now.getTime() + GITHUB_CHECKOUT_TOKEN_STALE_MINIMUM_MS &&
      !activeTerminalBackoff(envelope),
  );
}

function activeBackoff(
  envelope: GithubCheckoutTokenEnvelope,
  now: Date,
): envelope is GithubCheckoutTokenEnvelope & {
  backoffUntil: Date;
  backoffReason: IntegrationProviderErrorReason;
} {
  return Boolean(
    envelope.backoffUntil &&
      envelope.backoffReason &&
      envelope.backoffUntil.getTime() > now.getTime(),
  );
}

function activeTerminalBackoff(envelope: GithubCheckoutTokenEnvelope): boolean {
  return Boolean(
    envelope.backoffReason && mintErrorClassForReason(envelope.backoffReason) === 'terminal',
  );
}

function shouldRejectForGuard(
  envelope: GithubCheckoutTokenEnvelope | undefined,
  rejectedGeneration: string | undefined,
  now: Date,
): boolean {
  return Boolean(
    envelope &&
      rejectedGeneration &&
      envelope.generation === rejectedGeneration &&
      envelope.rejectionRefreshNotBefore &&
      envelope.rejectionRefreshNotBefore.getTime() > now.getTime(),
  );
}

function rejectionGuardError(): GithubIntegrationProviderError {
  return new GithubIntegrationProviderError(
    'provider-rejected',
    'GitHub checkout token rejection is temporarily guarded for this exact scope',
    Math.ceil(GITHUB_CHECKOUT_TOKEN_REJECTION_GUARD_MS / 1000),
  );
}

function isUnusable(envelope: GithubCheckoutTokenEnvelope, now: Date): boolean {
  if (envelope.expiresAt && envelope.expiresAt.getTime() <= now.getTime()) return true;
  return Boolean(
    !envelope.token && envelope.backoffUntil && envelope.backoffUntil.getTime() <= now.getTime(),
  );
}

function isExpiredForCleanup(envelope: GithubCheckoutTokenEnvelope, now: Date): boolean {
  const completedAt = envelope.backoffUntil ?? envelope.expiresAt;
  return Boolean(
    completedAt && completedAt.getTime() + GITHUB_CHECKOUT_TOKEN_RETENTION_MS <= now.getTime(),
  );
}

function tokenFromEnvelope(
  envelope: GithubCheckoutTokenEnvelope,
  stale = false,
): GithubCheckoutToken {
  if (!envelope.token || !envelope.expiresAt || !envelope.generation) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub checkout token cache envelope is missing a token, expiry, or generation',
    );
  }
  return {
    token: envelope.token,
    expiresAt: envelope.expiresAt,
    generation: envelope.generation,
    ...(stale ? {stale: true} : {}),
  };
}

function validateMintedToken(
  scope: GithubCheckoutTokenScope,
  token: GithubInstallationAccessToken,
  now: Date,
): void {
  if (
    !token.token ||
    !(token.expiresAt instanceof Date) ||
    Number.isNaN(token.expiresAt.getTime()) ||
    token.expiresAt.getTime() <= now.getTime()
  ) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub checkout token response is missing a token or valid expiry',
    );
  }
  if (
    token.repositoryIds !== undefined &&
    (token.repositoryIds.length !== 1 || token.repositoryIds[0] !== scope.repositoryId)
  ) {
    throw new GithubIntegrationProviderError(
      'provider-rejected',
      'GitHub checkout token response names a different repository',
    );
  }
  if (!token.permissions) return;
  for (const [permission, level] of Object.entries(scope.permissions)) {
    if (token.permissions[permission] !== level) {
      throw new GithubIntegrationProviderError(
        'provider-rejected',
        'GitHub checkout token response does not match the requested permissions',
      );
    }
  }
  for (const [permission, level] of Object.entries(token.permissions)) {
    if (
      !(permission in scope.permissions) &&
      !(BASELINE_PERMISSION_KEYS.has(permission) && level === 'read')
    ) {
      throw new GithubIntegrationProviderError(
        'provider-rejected',
        'GitHub checkout token response contains an out-of-scope permission',
      );
    }
  }
}

function newGeneration(rejectedGeneration: string | undefined): string {
  let generation = randomUUID();
  while (generation === rejectedGeneration) generation = randomUUID();
  return generation;
}

function isProviderErrorReason(value: unknown): value is IntegrationProviderErrorReason {
  return (
    typeof value === 'string' && PROVIDER_ERROR_REASONS.has(value as IntegrationProviderErrorReason)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isPermissions(value: unknown): value is Record<string, Permission> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([key, level]) => key.length > 0 && (level === 'read' || level === 'write'),
  );
}

function isBackoffError(value: unknown): value is {message: string; status?: number} {
  return (
    isRecord(value) &&
    typeof value.message === 'string' &&
    (value.status === undefined || typeof value.status === 'number')
  );
}

function parseJsonRecord(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isValidEnvelopeShape(value: Record<string, unknown>): value is Record<string, unknown> & {
  repositoryId: number;
  permissions: Record<string, Permission>;
  generation?: string;
  token?: string;
  backoffReason?: IntegrationProviderErrorReason;
  backoffError?: {message: string; status?: number};
} {
  return (
    value.version === GITHUB_CHECKOUT_TOKEN_CACHE_VERSION &&
    isPositiveInteger(value.repositoryId) &&
    isPermissions(value.permissions) &&
    (value.token === undefined || (typeof value.token === 'string' && value.token.length > 0)) &&
    (value.generation === undefined || typeof value.generation === 'string') &&
    (value.backoffReason === undefined || isProviderErrorReason(value.backoffReason)) &&
    (value.backoffError === undefined || isBackoffError(value.backoffError))
  );
}

function parseEnvelopeDates(
  value: Record<string, unknown>,
): Partial<Record<'expiresAt' | 'backoffUntil' | 'rejectionRefreshNotBefore', Date>> | undefined {
  const dates = ['expiresAt', 'backoffUntil', 'rejectionRefreshNotBefore'] as const;
  const parsed: Partial<Record<(typeof dates)[number], Date>> = {};
  for (const name of dates) {
    const rawDate = value[name];
    if (rawDate === undefined) continue;
    if (typeof rawDate !== 'string') return undefined;
    const date = new Date(rawDate);
    if (Number.isNaN(date.getTime())) return undefined;
    parsed[name] = date;
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onLateResult?: (value: T) => Promise<void>,
  onTimeout?: (lateWork: Promise<void>) => void,
): Promise<T> {
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  const lateWork: Promise<void> = promise.then(
    async (value) => {
      if (timedOut && onLateResult) await onLateResult(value);
    },
    () => undefined,
  );
  void lateWork.catch(() => undefined);
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      onTimeout?.(lateWork);
      reject(
        new GithubIntegrationProviderError('timeout', 'Timed out minting GitHub checkout token'),
      );
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
