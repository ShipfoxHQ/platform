import {sql} from 'drizzle-orm';
import {GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT} from '#api/installation-token-envelope.js';
import {recordInstallationTokenLockWait} from '#metrics/index.js';
import {db} from './db.js';

export type InstallationTokenLockResult<T> = {acquired: true; value: T} | {acquired: false};

export function withInstallationTokenLock<T>(
  installationId: number,
  fn: () => Promise<T>,
): Promise<InstallationTokenLockResult<T>>;
export function withInstallationTokenLock<T>(
  installationId: number,
  permissionFingerprint: string,
  fn: () => Promise<T>,
): Promise<InstallationTokenLockResult<T>>;
export function withInstallationTokenLock<T>(
  installationId: number,
  fingerprintOrFn: string | (() => Promise<T>),
  maybeFn?: () => Promise<T>,
): Promise<InstallationTokenLockResult<T>> {
  const permissionFingerprint =
    typeof fingerprintOrFn === 'string'
      ? fingerprintOrFn
      : GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT;
  const operation = typeof fingerprintOrFn === 'function' ? fingerprintOrFn : maybeFn;
  if (!operation) throw new Error('GitHub installation token lock operation is required');
  const lockKey = installationTokenLockKey(installationId, permissionFingerprint);
  return db().transaction(async (tx) => {
    const startedAt = Date.now();
    const lock = await tx.execute<{acquired: boolean}>(sql`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS acquired
    `);
    const acquired = lock.rows[0]?.acquired === true;
    if (!acquired) {
      recordInstallationTokenLockWait(Date.now() - startedAt);
      return {acquired: false};
    }

    try {
      const value = await operation();
      return {acquired: true, value};
    } finally {
      recordInstallationTokenLockWait(Date.now() - startedAt);
    }
  });
}

function installationTokenLockKey(installationId: number, permissionFingerprint: string): string {
  if (!Number.isSafeInteger(installationId) || installationId < 0) {
    throw new Error(`Invalid GitHub installation id for advisory lock: ${installationId}`);
  }
  if (permissionFingerprint.length === 0) {
    throw new Error('GitHub installation token permission fingerprint cannot be empty');
  }

  return permissionFingerprint === GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT
    ? String(-BigInt(installationId) - 1n)
    : `github-installation-token:${installationId}:${permissionFingerprint}`;
}
