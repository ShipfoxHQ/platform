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
  const base = -BigInt(installationId) - 1n;
  if (scopeKey === undefined) return String(base);

  // Scoped mints serialize per (installation, scope) instead of per installation:
  // fold a stable hash of the scope into the negative key so same-scope contenders
  // for one installation contend, while different scopes mint concurrently. A hash
  // collision only makes unrelated mints serialize briefly; each mint still reads
  // and writes only its own scope envelope.
  let hash = 0;
  for (let index = 0; index < scopeKey.length; index += 1) {
    hash = (hash * 31 + scopeKey.charCodeAt(index)) >>> 0;
  }
  return String(base - BigInt(hash));
}
