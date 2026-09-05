import {randomUUID} from 'node:crypto';
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

export type DeleteInstallationNamespaceFn = (installationId: number) => Promise<number>;

export interface DeleteInstallationOptions {
  workspaceId?: string | undefined;
  deleteNamespace?: DeleteInstallationNamespaceFn | undefined;
}

export interface InstallationTokenCache {
  getOrMint(
    installationId: number,
    permissionFingerprint: string,
    mint: () => Promise<GithubInstallationAccessToken>,
  ): Promise<GithubInstallationAccessToken>;
  deleteInstallation?(installationId: number, options?: DeleteInstallationOptions): Promise<number>;
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
  readGeneration(workspaceId: string, installationId: number): Promise<string | null>;
  writeGeneration(workspaceId: string, installationId: number, generation: string): Promise<void>;
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
  /** Whether the compatibility-profile lock is the same lock as withLock. */
  shareCompatibilityLock?: boolean | undefined;
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
type InstallationTokenGeneration = string | null | undefined;
type InstallationTokenEnvelopeWriteResult = 'written' | 'skipped' | 'contended';
type InstallationTokenBackoffResult = {until: Date; persisted: boolean};

export class SharedInstallationTokenCache implements InstallationTokenCache {
  private readonly workspaceIds = new Map<number, {workspaceId: string; expiresAtMs: number}>();
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollDelaysMs: number[];
  private readonly workspaceCacheTtlMs: number;
  private readonly mintTimeoutMs: number;
  private readonly shareCompatibilityLock: boolean;

  constructor(private readonly options: SharedInstallationTokenCacheOptions) {
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => sleepTimeout(ms).then(() => undefined));
    this.pollDelaysMs = options.pollDelaysMs ?? DEFAULT_POLL_DELAYS_MS;
    this.workspaceCacheTtlMs = options.workspaceCacheTtlMs ?? DEFAULT_WORKSPACE_CACHE_TTL_MS;
    this.mintTimeoutMs = options.mintTimeoutMs ?? DEFAULT_MINT_TIMEOUT_MS;
    this.shareCompatibilityLock =
      options.shareCompatibilityLock ?? options.withBackoffLock === undefined;
  }

  async deleteInstallation(
    installationId: number,
    options: DeleteInstallationOptions = {},
  ): Promise<number> {
    const workspaceId = options.workspaceId ?? (await this.resolveWorkspaceId(installationId));
    const result = await this.withBackoffLock(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      async () => {
        const generation = randomUUID();
        await this.options.secretStore.writeGeneration(workspaceId, installationId, generation);
        const deleted = options.deleteNamespace ? await options.deleteNamespace(installationId) : 0;
        // Namespace deletion removes GENERATION with the token envelopes, so restore it after deletion.
        await this.options.secretStore.writeGeneration(workspaceId, installationId, generation);
        return deleted;
      },
    );
    if (!result.acquired) {
      throw new GithubIntegrationProviderError(
        'provider-unavailable',
        'GitHub installation token invalidation is still in progress',
        1,
      );
    }
    this.workspaceIds.delete(installationId);
    return result.value;
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
    const generation = await this.readGeneration(workspaceId, installationId, reportReadFailure);
    const envelope = await this.readEnvelope(
      workspaceId,
      installationId,
      profileKey,
      backoffKeys,
      reportReadFailure,
      generation,
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
          generation,
          compatibilityLockHeld:
            permissionFingerprint === GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT &&
            this.shareCompatibilityLock,
        }),
      );
    } catch (error) {
      if (!(error instanceof InstallationTokenMintFailure)) throw error;
      const backoff = await this.recordBackoff({
        workspaceId,
        installationId,
        profileKey,
        profileBackoffKey,
        permissionFingerprint,
        reportReadFailure,
        failure: error,
        generation,
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
            backoffUntil: backoff.until.toISOString(),
            backoffPersisted: backoff.persisted,
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
          backoffUntil: backoff.until.toISOString(),
          backoffPersisted: backoff.persisted,
          error: error.providerError,
        },
        backoff.persisted
          ? 'github installation token mint failed; backoff recorded'
          : 'github installation token mint failed; backoff was not persisted',
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
        generation,
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
      generation,
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
    generation: InstallationTokenGeneration;
    compatibilityLockHeld: boolean;
  }): Promise<GithubInstallationAccessToken> {
    const envelope = await this.readEnvelope(
      params.workspaceId,
      params.installationId,
      params.profileKey,
      params.backoffKeys,
      params.reportReadFailure,
      params.generation,
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

    logger().info(
      {
        installationId: params.installationId,
        permissionProfile: params.profileKey,
        expiresAt: token.expiresAt.toISOString(),
      },
      'github installation token minted',
    );
    recordInstallationTokenLookup('minted');
    try {
      const writeResult = await this.writeEnvelope(
        params.workspaceId,
        params.installationId,
        params.profileKey,
        {
          token: token.token,
          expiresAt: token.expiresAt,
          permissions: token.permissions,
        },
        params.generation,
        params.compatibilityLockHeld,
        params.reportReadFailure,
      );
      if (writeResult === 'contended') {
        logger().warn(
          {
            installationId: params.installationId,
            permissionProfile: params.profileKey,
          },
          'github installation token cache write lock was contended',
        );
      }
    } catch (error) {
      logger().warn(
        {installationId: params.installationId, error},
        'github installation token cache write failed',
      );
      reportError(error, {
        boundary: 'integration.cache',
        operation: 'write-minted-token',
        extra: {installationId: params.installationId},
      });
    }
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
    generation: InstallationTokenGeneration;
  }): Promise<InstallationTokenBackoffResult> {
    const candidateUntil = new Date(this.now().getTime() + backoffMs(params.failure.failure));
    const backoffScope = mintBackoffScopeForReason(params.failure.failure.reason);
    const backoffKey =
      backoffScope === 'installation'
        ? GITHUB_INSTALLATION_TOKEN_BACKOFF_KEY
        : params.profileBackoffKey;
    const generation = params.generation;
    if (generation === undefined) {
      logger().warn(
        {
          installationId: params.installationId,
          permissionProfile: params.profileKey,
          reason: params.failure.failure.reason,
        },
        'github installation token backoff was not persisted because generation is unavailable',
      );
      return {until: candidateUntil, persisted: false};
    }
    const persistWithCompatibility = async (): Promise<
      InstallationTokenLockResult<InstallationTokenBackoffResult>
    > =>
      await this.withBackoffLock(
        params.installationId,
        GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
        async () => {
          if (
            !(await this.generationMatches(
              params.workspaceId,
              params.installationId,
              generation,
              params.reportReadFailure,
            ))
          ) {
            return {until: candidateUntil, persisted: false};
          }
          return await this.persistBackoff({
            ...params,
            generation,
            backoffKey,
            candidateUntil,
          });
        },
      );

    try {
      if (params.permissionFingerprint === GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT) {
        const result = await persistWithCompatibility();
        if (result.acquired) return result.value;
        logger().warn(
          {
            installationId: params.installationId,
            permissionProfile: params.profileKey,
            reason: params.failure.failure.reason,
          },
          'github installation token backoff was not persisted after lock contention',
        );
        return {until: candidateUntil, persisted: false};
      }
      if (backoffScope === 'installation') {
        const result = await persistWithCompatibility();
        if (result.acquired) return result.value;
        logger().warn(
          {
            installationId: params.installationId,
            permissionProfile: params.profileKey,
            reason: params.failure.failure.reason,
          },
          'github installation token backoff was not persisted after lock contention',
        );
      } else {
        const profileResult = await this.withProfileLock(
          params.installationId,
          params.permissionFingerprint,
          async () => {
            const result = await persistWithCompatibility();
            return result.acquired ? result.value : undefined;
          },
        );
        if (profileResult.acquired && profileResult.value !== undefined) {
          return profileResult.value;
        }

        // The profile lock can remain busy while another mint is finishing. The
        // compatibility lock still serializes the envelope read-modify-write,
        // so persist after the profile poll rather than dropping the breaker.
        const fallback = await persistWithCompatibility();
        if (fallback.acquired) {
          logger().warn(
            {
              installationId: params.installationId,
              permissionProfile: params.profileKey,
              reason: params.failure.failure.reason,
            },
            'github installation token profile backoff lock was contended; persisted under installation lock',
          );
          return fallback.value;
        }
        logger().warn(
          {
            installationId: params.installationId,
            permissionProfile: params.profileKey,
            reason: params.failure.failure.reason,
          },
          'github installation token backoff was not persisted after profile and compatibility lock contention',
        );
      }
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
    return {until: candidateUntil, persisted: false};
  }

  private async persistBackoff(params: {
    workspaceId: string;
    installationId: number;
    profileKey: string;
    backoffKey: string;
    reportReadFailure: (error: unknown) => void;
    failure: InstallationTokenMintFailure;
    generation: InstallationTokenGeneration;
    candidateUntil: Date;
  }): Promise<InstallationTokenBackoffResult> {
    let readFailed = false;
    const reportReadFailure = (error: unknown) => {
      readFailed = true;
      params.reportReadFailure(error);
    };
    const envelope = await this.readEnvelope(
      params.workspaceId,
      params.installationId,
      params.profileKey,
      [params.backoffKey],
      reportReadFailure,
      params.generation,
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
      existingBackoff && existingBackoff.backoffUntil.getTime() >= params.candidateUntil.getTime()
        ? existingBackoff
        : {
            backoffUntil: params.candidateUntil,
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
        params.backoffKey,
        selectedBackoff,
        params.generation,
        true,
        params.reportReadFailure,
      ),
    ];
    if (!readFailed) {
      writes.push(
        this.writeEnvelope(
          params.workspaceId,
          params.installationId,
          params.profileKey,
          {
            token: envelope?.token,
            expiresAt: envelope?.expiresAt,
            permissions: envelope?.permissions,
          },
          params.generation,
          true,
          params.reportReadFailure,
        ),
      );
    }
    const writeResults = await Promise.all(writes);
    return {
      until: selectedBackoff.backoffUntil,
      persisted: writeResults.every((result) => result === 'written'),
    };
  }

  private async withProfileLock<T>(
    installationId: number,
    permissionFingerprint: string,
    operation: () => Promise<T>,
  ): Promise<InstallationTokenLockResult<T>> {
    for (const delayMs of [0, ...this.pollDelaysMs]) {
      if (delayMs > 0) await this.sleep(delayMs);
      const result = await this.options.withLock(installationId, permissionFingerprint, operation);
      if (result.acquired) return result;
    }
    return {acquired: false};
  }

  private async clearBackoff(params: {
    workspaceId: string;
    installationId: number;
    profileKey: string;
    backoffKeys: readonly string[];
    reportReadFailure: (error: unknown) => void;
    generation: InstallationTokenGeneration;
  }): Promise<void> {
    try {
      await this.withBackoffLock(
        params.installationId,
        GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
        async () => {
          if (
            !(await this.generationMatches(
              params.workspaceId,
              params.installationId,
              params.generation,
              params.reportReadFailure,
            ))
          )
            return;
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
            params.generation,
          );
          if (readFailed || activeBackoff(envelope, this.now())) return;
          await Promise.all(
            params.backoffKeys.map((backoffKey) =>
              this.writeEnvelope(
                params.workspaceId,
                params.installationId,
                backoffKey,
                {},
                params.generation,
                true,
                params.reportReadFailure,
              ),
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
    generation: InstallationTokenGeneration;
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
        params.generation,
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
    generation: InstallationTokenGeneration,
  ): Promise<InstallationTokenEnvelope | undefined> {
    const isCompatibilityProfile =
      profileKey === githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT);
    const {profileResult, backoffResults, fixedEnvelopeResult} = await readSecretValues(
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

    const profileRaw = settledRaw(profileResult);
    const backoffRaws = backoffResults.map(settledRaw);
    const fixedEnvelopeRaw = settledRaw(fixedEnvelopeResult);
    let profile = matchesGeneration(parseRawEnvelope(profileRaw, installationId), generation);
    let backoff = latestBackoff(
      backoffRaws.map((backoffRaw) =>
        matchesGeneration(parseRawEnvelope(backoffRaw, installationId), generation),
      ),
      this.now(),
    );
    const fixedEnvelope = matchesGeneration(
      parseRawEnvelope(fixedEnvelopeRaw, installationId),
      generation,
    );
    if (isCompatibilityProfile && profile === undefined && profileRaw === null) {
      profile = fixedEnvelope;
    }
    if (
      isCompatibilityProfile &&
      backoff === undefined &&
      backoffRaws.length === 1 &&
      backoffRaws[0] === null
    ) {
      backoff = fixedEnvelope;
    }
    if (!profile && !backoff) return undefined;
    return {
      ...profile,
      ...(backoff?.generation === undefined ? {} : {generation: backoff.generation}),
      ...(backoff?.backoffUntil === undefined ? {} : {backoffUntil: backoff.backoffUntil}),
      ...(backoff?.backoffReason === undefined ? {} : {backoffReason: backoff.backoffReason}),
      ...(backoff?.backoffError === undefined ? {} : {backoffError: backoff.backoffError}),
    };
  }

  private async readGeneration(
    workspaceId: string,
    installationId: number,
    reportReadFailure?: (error: unknown) => void,
  ): Promise<InstallationTokenGeneration> {
    try {
      return await this.options.secretStore.readGeneration(workspaceId, installationId);
    } catch (error) {
      reportReadFailure?.(error);
      return undefined;
    }
  }

  private async writeEnvelope(
    workspaceId: string,
    installationId: number,
    key: string,
    envelope: InstallationTokenEnvelope,
    generation: InstallationTokenGeneration,
    lockHeld: boolean,
    reportReadFailure?: (error: unknown) => void,
  ): Promise<InstallationTokenEnvelopeWriteResult> {
    const write = async (): Promise<InstallationTokenEnvelopeWriteResult> => {
      if (generation === undefined) return 'skipped';
      const currentGeneration = await this.readGeneration(
        workspaceId,
        installationId,
        reportReadFailure,
      );
      if (currentGeneration !== generation) return 'skipped';
      await this.options.secretStore.write(workspaceId, installationId, key, {
        ...envelope,
        ...(generation === null ? {} : {generation}),
      });
      return 'written';
    };
    if (lockHeld) return await write();
    const result = await this.withBackoffLock(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      write,
    );
    if (!result.acquired) return 'contended';
    return result.value;
  }

  private async generationMatches(
    workspaceId: string,
    installationId: number,
    generation: InstallationTokenGeneration,
    reportReadFailure?: (error: unknown) => void,
  ): Promise<boolean> {
    if (generation === undefined) return false;
    const currentGeneration = await this.readGeneration(
      workspaceId,
      installationId,
      reportReadFailure,
    );
    return currentGeneration === generation;
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
  const [profileResult, fixedEnvelopeResult] = await Promise.allSettled([
    profileRead,
    fixedEnvelopeRead,
  ]);
  const backoffResults = await Promise.allSettled(backoffReads);
  return {
    profileResult,
    backoffResults,
    fixedEnvelopeResult,
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

function matchesGeneration(
  envelope: InstallationTokenEnvelope | undefined,
  generation: InstallationTokenGeneration,
): InstallationTokenEnvelope | undefined {
  if (envelope === undefined) return undefined;
  // A failed marker read must not serve a persisted token that may predate an
  // invalidation. Backoff recording handles this degraded mode separately.
  if (generation === undefined) return undefined;
  return envelope.generation === (generation ?? undefined) ? envelope : undefined;
}

function latestBackoff(
  envelopes: readonly (InstallationTokenEnvelope | undefined)[],
  now: Date,
): InstallationTokenEnvelope | undefined {
  let latest: InstallationTokenEnvelope | undefined;
  let latestActiveTerminal: InstallationTokenEnvelope | undefined;
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
    const latestActiveTerminalUntil = latestActiveTerminal?.backoffUntil;
    if (
      envelope.backoffUntil > now &&
      mintErrorClassForReason(envelope.backoffReason) === 'terminal' &&
      (latestActiveTerminalUntil === undefined || envelope.backoffUntil > latestActiveTerminalUntil)
    ) {
      latestActiveTerminal = envelope;
    }
  }
  return latestActiveTerminal ?? latest;
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
