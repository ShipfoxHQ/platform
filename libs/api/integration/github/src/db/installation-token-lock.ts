import {sql} from 'drizzle-orm';
import {recordInstallationTokenLockWait} from '#metrics/index.js';
import {db} from './db.js';

export type InstallationTokenLockResult<T> = {acquired: true; value: T} | {acquired: false};

export function withInstallationTokenLock<T>(
  installationId: number,
  scopeKey: string | undefined,
  fn: () => Promise<T>,
): Promise<InstallationTokenLockResult<T>> {
  const lockKey = installationTokenLockKey(installationId, scopeKey);
  return db().transaction(async (tx) => {
    const startedAt = Date.now();
    const lock = await tx.execute<{acquired: boolean}>(sql`
      SELECT pg_try_advisory_xact_lock(${lockKey}::bigint) AS acquired
    `);
    const acquired = lock.rows[0]?.acquired === true;
    if (!acquired) {
      recordInstallationTokenLockWait(Date.now() - startedAt);
      return {acquired: false};
    }

    try {
      const value = await fn();
      return {acquired: true, value};
    } finally {
      recordInstallationTokenLockWait(Date.now() - startedAt);
    }
  });
}

function installationTokenLockKey(installationId: number, scopeKey: string | undefined): string {
  if (!Number.isSafeInteger(installationId) || installationId < 0) {
    throw new Error(`Invalid GitHub installation id for advisory lock: ${installationId}`);
  }

  // Keep these exact per-installation keys away from positive advisory-lock ids.
  if (scopeKey === undefined) return String(-BigInt(installationId) - 1n);

  // Scoped mints serialize per (installation, scope) instead of per installation.
  // Unscoped keys occupy [-(2^53), -1] (one per valid installation id), so scoped
  // keys are placed strictly below -(2^53): a scoped lock can never equal the
  // unscoped lock of another installation. Same-scope contenders for one
  // installation contend; a hash collision only makes unrelated mints serialize
  // briefly, and each mint still reads and writes only its own scope envelope.
  const hash = installationTokenScopeLockHash(`${installationId}:${scopeKey}`);
  return String(-(2n ** 53n) - 1n - hash);
}

// FNV-1a 64-bit masked to 62 bits: deterministic across processes so every
// instance derives the same advisory-lock key for one (installation, scope), and
// bounded so the negative key always fits Postgres' signed 64-bit bigint.
function installationTokenScopeLockHash(input: string): bigint {
  const prime = 0x100000001b3n;
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash & 0x3fffffffffffffffn;
}
