import {
  type ConsumeRateLimitParams,
  type ConsumeRateLimitResult,
  createRateLimitPersistence,
} from '@shipfox/node-rate-limit';
import {lt, sql} from 'drizzle-orm';
import {db} from './db.js';
import {runnersRateLimits} from './schema/rate-limits.js';

type RunnersRateLimitTransaction = Parameters<
  Parameters<ReturnType<typeof db>['transaction']>[0]
>[0];

const persistence = createRateLimitPersistence<RunnersRateLimitTransaction>({
  transaction: (callback) => db().transaction(callback),
  setStatementTimeout: async (transaction, timeoutMs) => {
    await transaction.execute(
      sql`select set_config('statement_timeout', ${`${timeoutMs}ms`}, true)`,
    );
  },
  consume: async (transaction, params) => {
    const rows = await transaction
      .insert(runnersRateLimits)
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
          runnersRateLimits.action,
          runnersRateLimits.scope,
          runnersRateLimits.identifierHmac,
          runnersRateLimits.windowStart,
        ],
        set: {
          count: sql`${runnersRateLimits.count} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning({count: runnersRateLimits.count, expiresAt: runnersRateLimits.expiresAt});

    return rows[0];
  },
  prune: async (now) => {
    const result = await db().delete(runnersRateLimits).where(lt(runnersRateLimits.expiresAt, now));
    return result.rowCount ?? 0;
  },
});

export type ConsumeRunnersRateLimitParams = ConsumeRateLimitParams<string, string>;
export type ConsumeRunnersRateLimitResult = ConsumeRateLimitResult;
export const consumeRunnersRateLimit = persistence.consume;
export const pruneExpiredRunnersRateLimits = persistence.prune;
