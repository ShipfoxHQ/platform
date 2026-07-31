import {
  type ConsumeRateLimitParams,
  type ConsumeRateLimitResult,
  createRateLimitPersistence,
} from '@shipfox/node-rate-limit';
import {lt, sql} from 'drizzle-orm';
import {db} from './db.js';
import {workspacesRateLimits} from './schema/rate-limits.js';

type WorkspacesRateLimitTransaction = Parameters<
  Parameters<ReturnType<typeof db>['transaction']>[0]
>[0];

const persistence = createRateLimitPersistence<WorkspacesRateLimitTransaction>({
  transaction: (callback) => db().transaction(callback),
  setStatementTimeout: async (transaction, timeoutMs) => {
    await transaction.execute(
      sql`select set_config('statement_timeout', ${`${timeoutMs}ms`}, true)`,
    );
  },
  consume: async (transaction, params) => {
    const rows = await transaction
      .insert(workspacesRateLimits)
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
          workspacesRateLimits.action,
          workspacesRateLimits.scope,
          workspacesRateLimits.identifierHmac,
          workspacesRateLimits.windowStart,
        ],
        set: {
          count: sql`${workspacesRateLimits.count} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning({count: workspacesRateLimits.count, expiresAt: workspacesRateLimits.expiresAt});

    return rows[0];
  },
  prune: async (now) => {
    const result = await db()
      .delete(workspacesRateLimits)
      .where(lt(workspacesRateLimits.expiresAt, now));
    return result.rowCount ?? 0;
  },
});

export type ConsumeWorkspacesRateLimitParams = ConsumeRateLimitParams<string, string>;
export type ConsumeWorkspacesRateLimitResult = ConsumeRateLimitResult;
export const consumeWorkspacesRateLimit = persistence.consume;
export const pruneExpiredWorkspacesRateLimits = persistence.prune;
