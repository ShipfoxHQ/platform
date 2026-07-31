import {lt, sql} from 'drizzle-orm';
import {db} from './db.js';
import {workspacesRateLimits} from './schema/rate-limits.js';

export interface ConsumeWorkspacesRateLimitParams {
  action: string;
  scope: string;
  identifierHmac: string;
  windowStart: Date;
  expiresAt: Date;
  timeoutMs: number;
}

export interface ConsumeWorkspacesRateLimitResult {
  count: number;
  expiresAt: Date;
}

export async function consumeWorkspacesRateLimit(
  params: ConsumeWorkspacesRateLimitParams,
): Promise<ConsumeWorkspacesRateLimitResult> {
  return await db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('statement_timeout', ${`${params.timeoutMs}ms`}, true)`);

    const rows = await tx
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

    const row = rows[0];
    if (!row) throw new Error('Rate limit upsert returned no rows');
    return row;
  });
}

let nextPruneAt = 0;

export async function pruneExpiredWorkspacesRateLimits(
  params: {now?: Date | undefined; minIntervalMs?: number | undefined} = {},
): Promise<number | undefined> {
  const now = params.now ?? new Date();
  const minIntervalMs = params.minIntervalMs ?? 60_000;
  if (minIntervalMs > 0 && now.getTime() < nextPruneAt) return undefined;

  nextPruneAt = now.getTime() + minIntervalMs;

  const result = await db()
    .delete(workspacesRateLimits)
    .where(lt(workspacesRateLimits.expiresAt, now));

  return result.rowCount ?? 0;
}
