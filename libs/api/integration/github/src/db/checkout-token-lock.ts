import {sql} from 'drizzle-orm';
import {recordGithubCheckoutTokenLockWait} from '#metrics/instance.js';
import {db} from './db.js';

const SCOPE_DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

export type GithubCheckoutTokenLockResult<T> = {acquired: true; value: T} | {acquired: false};

/** Uses the complete versioned scope digest, rather than an installation-wide lock. */
export function withGithubCheckoutTokenLock<T>(
  scopeDigest: string,
  fn: () => Promise<T>,
): Promise<GithubCheckoutTokenLockResult<T>> {
  if (!SCOPE_DIGEST_PATTERN.test(scopeDigest)) {
    throw new Error('Invalid GitHub checkout token scope digest for advisory lock');
  }
  return db().transaction(async (tx) => {
    const startedAt = Date.now();
    const lock = await tx.execute<{acquired: boolean}>(sql`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${scopeDigest}, 0)) AS acquired
    `);
    const acquired = lock.rows[0]?.acquired === true;
    if (!acquired) {
      recordGithubCheckoutTokenLockWait(Date.now() - startedAt);
      return {acquired: false};
    }

    recordGithubCheckoutTokenLockWait(Date.now() - startedAt);
    return {acquired: true, value: await fn()};
  });
}
