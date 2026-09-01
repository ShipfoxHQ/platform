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
  GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
  GITHUB_INSTALLATION_TOKEN_BACKOFF_KEY,
  GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY,
  GITHUB_LEGACY_INSTALLATION_TOKEN_KEY,
  githubInstallationTokenBackoffKey,
  githubInstallationTokenBackoffKeys,
  githubInstallationTokenKey,
  type InstallationTokenEnvelope,
  mintBackoffScopeForReason,
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
    permissionFingerprint: string,
    mint: () => Promise<GithubInstallationAccessToken>,
  ): Promise<GithubInstallationAccessToken>;
}

export type InstallationTokenLockResult<T> = {acquired: true; value: T} | {acquired: false};

export interface InstallationTokenSecretStore {
  read(workspaceId: string, installationId: number, key: string): Promise<string | null>;
  write(
    workspaceId: string,
    installationId: number,
    key: string,
    envelope: InstallationTokenEnvelope,
  ): Promise<void>;
}

type InstallationTokenLock = <T>(
  installationId: number,
  permissionFingerprint: string,
  fn: () => Promise<T>,
) => Promise<InstallationTokenLockResult<T>>;

export interface SharedInstallationTokenCacheOptions {
  secretStore: InstallationTokenSecretStore;
  withLock: InstallationTokenLock;
  withBackoffLock?: InstallationTokenLock | undefined;
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
    permissionFingerprint: string,
    mint: () => Promise<GithubInstallationAccessToken>,
  ): Promise<GithubInstallationAccessToken> {
    const workspaceId = await this.resolveWorkspaceId(installationId);
    const profileKey = githubInstallationTokenKey(permissionFingerprint);
    const backoffKeys = githubInstallationTokenBackoffKeys(permissionFingerprint);
    const profileBackoffKey = githubInstallationTokenBackoffKey(permissionFingerprint);
    let readFailureReported = false;
    const reportReadFailure = (error: unknown) => {
      if (readFailureReported) return;
      readFailureReported = true;
      logger().warn({installationId, error}, 'github installation token cache read failed');
      reportError(error, {
        boundary: 'integration.cache',
        operation: 'read-envelope',
        extra: {installationId},
      });
    };
    const envelope = await this.readEnvelope(
      workspaceId,
      installationId,
      profileKey,
      backoffKeys,
      reportReadFailure,
    );
    if (usable(envelope, this.now())) {
      recordInstallationTokenLookup('db-hit');
      return tokenFromEnvelope(envelope);
    }

    let result: InstallationTokenLockResult<GithubInstallationAccessToken>;
    try {
      result = await this.options.withLock(installationId, permissionFingerprint, () =>
        this.mintUnderLock({
          workspaceId,
          installationId,
          profileKey,
          backoffKeys,
          permissionFingerprint,
          mint,
          reportReadFailure,
        }),
      );
    } catch (error) {
      if (!(error instanceof InstallationTokenMintFailure)) throw error;
      const until = await this.recordBackoff({
        workspaceId,
        installationId,
        profileKey,
        profileBackoffKey,
        permissionFingerprint,
        reportReadFailure,
        failure: error,
      });
      if (
        error.failure.class === 'transient' &&
        error.failureEnvelope?.token &&
        stillValid(error.failureEnvelope.expiresAt, this.now())
      ) {
        logger().warn(
          {
            installationId,
            expiresAt: error.failureEnvelope.expiresAt?.toISOString(),
            permissionProfile: profileKey,
            reason: error.providerError.reason,
            backoffUntil: until.toISOString(),
          },
          'github installation token mint failed; serving stale token',
        );
        recordInstallationTokenLookup('served-stale');
        return tokenFromEnvelope(error.failureEnvelope);
      }

      logger().warn(
        {
          installationId,
          permissionProfile: profileKey,
          reason: error.providerError.reason,
          backoffUntil: until.toISOString(),
          error: error.providerError,
        },
        'github installation token mint failed; backoff recorded',
      );
      recordInstallationTokenLookup('backoff');
      throw error.providerError;
    }
    if (result.acquired) {
      await this.clearBackoff({
        workspaceId,
        installationId,
        profileKey,
        backoffKeys,
        reportReadFailure,
      });
      return result.value;
    }

    return await this.serveStaleOrPoll({
      workspaceId,
      installationId,
      profileKey,
      backoffKeys,
      envelope,
      reportReadFailure,
    });
  }

  private async mintUnderLock(params: {
    workspaceId: string;
    installationId: number;
    profileKey: string;
    backoffKeys: readonly string[];
    permissionFingerprint: string;
    mint: () => Promise<GithubInstallationAccessToken>;
    reportReadFailure: (error: unknown) => void;
  }): Promise<GithubInstallationAccessToken> {
    const envelope = await this.readEnvelope(
      params.workspaceId,
      params.installationId,
      params.profileKey,
      params.backoffKeys,
      params.reportReadFailure,
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

    let token: GithubInstallationAccessToken;
    try {
      token = await this.recordMint(params.mint);
    } catch (error) {
      const providerError = toProviderError(error);
      const failure = classifyMintError(providerError);
      recordInstallationTokenBackoff({
        reason: failure.reason,
        class: failure.class,
        profile:
          params.permissionFingerprint === GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT
            ? 'compatibility'
            : 'scoped',
      });
      throw new InstallationTokenMintFailure(providerError, failure, envelope);
    }

    try {
      await this.writeEnvelope(params.workspaceId, params.installationId, params.profileKey, {
        token: token.token,
        expiresAt: token.expiresAt,
        permissions: token.permissions,
      });
    } catch (error) {
      logger().warn(
        {installationId: params.installationId, expiresAt: token.expiresAt.toISOString(), error},
        'github installation token cache write failed after mint',
      );
      reportError(error, {
        boundary: 'integration.cache',
        operation: 'write-minted-token',
        extra: {installationId: params.installationId},
      });
    }

    logger().info(
      {
        installationId: params.installationId,
        permissionProfile: params.profileKey,
        expiresAt: token.expiresAt.toISOString(),
      },
      'github installation token minted',
    );
    recordInstallationTokenLookup('minted');
    return token;
  }

  private async recordBackoff(params: {
    workspaceId: string;
    installationId: number;
    profileKey: string;
    profileBackoffKey: string;
    permissionFingerprint: string;
    reportReadFailure: (error: unknown) => void;
    failure: InstallationTokenMintFailure;
  }): Promise<Date> {
    const candidateUntil = new Date(this.now().getTime() + backoffMs(params.failure.failure));
    const backoffScope = mintBackoffScopeForReason(params.failure.failure.reason);
    const backoffKey =
      backoffScope === 'installation'
        ? GITHUB_INSTALLATION_TOKEN_BACKOFF_KEY
        : params.profileBackoffKey;
    const lockFingerprint =
      backoffScope === 'installation'
        ? GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT
        : params.permissionFingerprint;
    try {
      const result = await this.withBackoffLock(
        params.installationId,
        lockFingerprint,
        async () => {
          let readFailed = false;
          const reportReadFailure = (error: unknown) => {
            readFailed = true;
            params.reportReadFailure(error);
          };
          const envelope = await this.readEnvelope(
            params.workspaceId,
            params.installationId,
            params.profileKey,
            [backoffKey],
            reportReadFailure,
          );
          const existingBackoff =
            envelope?.backoffUntil !== undefined && envelope.backoffReason !== undefined
              ? {
                  backoffUntil: envelope.backoffUntil,
                  backoffReason: envelope.backoffReason,
                  backoffError: envelope.backoffError,
                }
              : undefined;
          const selectedBackoff =
            existingBackoff && existingBackoff.backoffUntil.getTime() >= candidateUntil.getTime()
              ? existingBackoff
              : {
                  backoffUntil: candidateUntil,
                  backoffReason: params.failure.failure.reason,
                  backoffError: {
                    message: params.failure.providerError.message,
                    ...(params.failure.providerError.status === undefined
                      ? {}
                      : {status: params.failure.providerError.status}),
                  },
                };

          const writes = [
            this.writeEnvelope(
              params.workspaceId,
              params.installationId,
              backoffKey,
              selectedBackoff,
            ),
          ];
          if (!readFailed) {
            writes.push(
              this.writeEnvelope(params.workspaceId, params.installationId, params.profileKey, {
                token: envelope?.token,
                expiresAt: envelope?.expiresAt,
                permissions: envelope?.permissions,
              }),
            );
          }
          await Promise.all(writes);
          return selectedBackoff.backoffUntil;
        },
      );

      if (result.acquired) return result.value;
      logger().warn(
        {
          installationId: params.installationId,
          permissionProfile: params.profileKey,
          reason: params.failure.failure.reason,
        },
        'github installation token backoff lock was contended',
      );
    } catch (error) {
      logger().warn(
        {
          installationId: params.installationId,
          permissionProfile: params.profileKey,
          reason: params.failure.failure.reason,
          error,
        },
        'github installation token backoff write failed',
      );
      reportError(error, {
        boundary: 'integration.cache',
        operation: 'write-backoff-envelope',
        extra: {installationId: params.installationId},
      });
    }
    return candidateUntil;
  }

  private async clearBackoff(params: {
    workspaceId: string;
    installationId: number;
    profileKey: string;
    backoffKeys: readonly string[];
    reportReadFailure: (error: unknown) => void;
  }): Promise<void> {
    try {
      await this.withBackoffLock(
        params.installationId,
        GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
        async () => {
          let readFailed = false;
          const envelope = await this.readEnvelope(
            params.workspaceId,
            params.installationId,
            params.profileKey,
            params.backoffKeys,
            (error) => {
              readFailed = true;
              params.reportReadFailure(error);
            },
          );
          if (readFailed || activeBackoff(envelope, this.now())) return;
          await Promise.all(
            params.backoffKeys.map((backoffKey) =>
              this.writeEnvelope(params.workspaceId, params.installationId, backoffKey, {}),
            ),
          );
        },
      );
    } catch (error) {
      logger().warn(
        {installationId: params.installationId, permissionProfile: params.profileKey, error},
        'github installation token backoff clear failed',
      );
      reportError(error, {
        boundary: 'integration.cache',
        operation: 'clear-backoff-envelope',
        extra: {installationId: params.installationId},
      });
    }
  }

  private async withBackoffLock<T>(
    installationId: number,
    permissionFingerprint: string,
    operation: () => Promise<T>,
  ): Promise<InstallationTokenLockResult<T>> {
    const withLock = this.options.withBackoffLock ?? this.options.withLock;
    for (const delayMs of [0, ...this.pollDelaysMs]) {
      if (delayMs > 0) await this.sleep(delayMs);
      const result = await withLock(installationId, permissionFingerprint, operation);
      if (result.acquired) return result;
    }
    return {acquired: false};
  }

  private async serveStaleOrPoll(params: {
    workspaceId: string;
    installationId: number;
    profileKey: string;
    backoffKeys: readonly string[];
    envelope: InstallationTokenEnvelope | undefined;
    reportReadFailure: (error: unknown) => void;
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
        params.profileKey,
        params.backoffKeys,
        params.reportReadFailure,
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
    profileKey: string,
    backoffKeys: readonly string[],
    reportReadFailure: (error: unknown) => void,
  ): Promise<InstallationTokenEnvelope | undefined> {
    const isCompatibilityProfile =
      profileKey === githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT);
    const {profileResult, backoffResults, fixedEnvelopeResult, legacyResult} =
      await readSecretValues(
        this.options.secretStore,
        workspaceId,
        installationId,
        profileKey,
        backoffKeys,
      );
    reportSecretReadFailure(profileResult, reportReadFailure);
    for (const backoffResult of backoffResults) {
      reportSecretReadFailure(backoffResult, reportReadFailure);
    }
    reportSecretReadFailure(fixedEnvelopeResult, reportReadFailure);
    reportSecretReadFailure(legacyResult, reportReadFailure);

    const profileRaw = settledRaw(profileResult);
    const backoffRaws = backoffResults.map(settledRaw);
    const fixedEnvelopeRaw = settledRaw(fixedEnvelopeResult);
    const legacyRaw = settledRaw(legacyResult);
    let profile = parseRawEnvelope(profileRaw, installationId);
    let backoff = latestBackoff(
      backoffRaws.map((backoffRaw) => parseRawEnvelope(backoffRaw, installationId)),
    );
    const fixedEnvelope = parseRawEnvelope(fixedEnvelopeRaw, installationId);
    const legacy = parseRawEnvelope(legacyRaw, installationId);
    const compatibilityEnvelope = fixedEnvelope ?? legacy;
    if (isCompatibilityProfile && profile === undefined && profileRaw === null) {
      profile = compatibilityEnvelope;
    }
    if (
      isCompatibilityProfile &&
      backoff === undefined &&
      backoffRaws.length === 1 &&
      backoffRaws[0] === null
    ) {
      backoff = compatibilityEnvelope;
    }
    if (!profile && !backoff) return undefined;
    return {
      ...profile,
      ...(backoff?.backoffUntil === undefined ? {} : {backoffUntil: backoff.backoffUntil}),
      ...(backoff?.backoffReason === undefined ? {} : {backoffReason: backoff.backoffReason}),
      ...(backoff?.backoffError === undefined ? {} : {backoffError: backoff.backoffError}),
    };
  }

  private async writeEnvelope(
    workspaceId: string,
    installationId: number,
    key: string,
    envelope: InstallationTokenEnvelope,
  ): Promise<void> {
    await this.options.secretStore.write(workspaceId, installationId, key, envelope);
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

type SettledSecretRead = PromiseSettledResult<string | null>;

interface InstallationTokenSecretReads {
  profileResult: SettledSecretRead;
  backoffResults: readonly SettledSecretRead[];
  fixedEnvelopeResult: SettledSecretRead;
  legacyResult: SettledSecretRead;
}

async function readSecretValues(
  secretStore: InstallationTokenSecretStore,
  workspaceId: string,
  installationId: number,
  profileKey: string,
  backoffKeys: readonly string[],
): Promise<InstallationTokenSecretReads> {
  const profileRead = secretStore.read(workspaceId, installationId, profileKey);
  const backoffReads = backoffKeys.map((backoffKey) =>
    secretStore.read(workspaceId, installationId, backoffKey),
  );
  const fixedEnvelopeRead = secretStore.read(
    workspaceId,
    installationId,
    GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY,
  );
  const legacyRead = secretStore.read(
    workspaceId,
    installationId,
    GITHUB_LEGACY_INSTALLATION_TOKEN_KEY,
  );
  const [profileResult, fixedEnvelopeResult, legacyResult] = await Promise.allSettled([
    profileRead,
    fixedEnvelopeRead,
    legacyRead,
  ]);
  const backoffResults = await Promise.allSettled(backoffReads);
  return {
    profileResult,
    backoffResults,
    fixedEnvelopeResult,
    legacyResult,
  };
}

function reportSecretReadFailure(
  result: SettledSecretRead,
  report: (error: unknown) => void,
): void {
  if (result.status === 'rejected') report(result.reason);
}

function settledRaw(result: SettledSecretRead): string | null | undefined {
  if (result.status === 'rejected') return undefined;
  return result.value;
}

function parseRawEnvelope(
  raw: string | null | undefined,
  installationId: number,
): InstallationTokenEnvelope | undefined {
  if (raw === null || raw === undefined) return undefined;
  const envelope = parseInstallationTokenEnvelope(raw);
  if (envelope === undefined) {
    logger().warn({installationId}, 'github installation token cache envelope failed to decode');
  }
  return envelope;
}

function latestBackoff(
  envelopes: readonly (InstallationTokenEnvelope | undefined)[],
): InstallationTokenEnvelope | undefined {
  let latest: InstallationTokenEnvelope | undefined;
  for (const envelope of envelopes) {
    if (envelope?.backoffUntil === undefined || envelope.backoffReason === undefined) continue;
    const latestBackoffUntil = latest?.backoffUntil;
    if (
      latest === undefined ||
      latestBackoffUntil === undefined ||
      envelope.backoffUntil > latestBackoffUntil
    ) {
      latest = envelope;
    }
  }
  return latest;
}

class InstallationTokenMintFailure extends Error {
  constructor(
    readonly providerError: GithubIntegrationProviderError,
    readonly failure: ClassifiedMintError,
    readonly failureEnvelope: InstallationTokenEnvelope | undefined,
  ) {
    super(providerError.message);
    this.name = 'InstallationTokenMintFailure';
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
