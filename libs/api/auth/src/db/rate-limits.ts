import {
  type ConsumeRateLimitParams,
  type ConsumeRateLimitResult,
  createRateLimitPersistence,
} from '@shipfox/node-rate-limit';
import {lt, sql} from 'drizzle-orm';
import {db} from './db.js';
import {authRateLimits} from './schema/rate-limits.js';

type AuthRateLimitTransaction = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

const persistence = createRateLimitPersistence<AuthRateLimitTransaction>({
  transaction: (callback) => db().transaction(callback),
  setStatementTimeout: async (transaction, timeoutMs) => {
    await transaction.execute(
      sql`select set_config('statement_timeout', ${`${timeoutMs}ms`}, true)`,
    );
  },
  consume: async (transaction, params) => {
    const rows = await transaction
      .insert(authRateLimits)
      .values({
        action: params.action,
        scope: params.scope,
        identifierHmac: params.identifierHmac,
        windowStart: params.windowStart,
        count: 1,
        expiresAt: params.expiresAt,
      })
      .onConflictDoUpdate({
        target: [
          authRateLimits.action,
          authRateLimits.scope,
          authRateLimits.identifierHmac,
          authRateLimits.windowStart,
        ],
        set: {
          count: sql`${authRateLimits.count} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning({count: authRateLimits.count, expiresAt: authRateLimits.expiresAt});

    return rows[0];
  },
  prune: async (now) => {
    const result = await db().delete(authRateLimits).where(lt(authRateLimits.expiresAt, now));
    return result.rowCount ?? 0;
  },
});

export type ConsumeAuthRateLimitParams = ConsumeRateLimitParams<string, string>;
export type ConsumeAuthRateLimitResult = ConsumeRateLimitResult;
export const consumeAuthRateLimit = persistence.consume;
export const pruneExpiredAuthRateLimits = persistence.prune;
