import {and, eq, sql} from 'drizzle-orm';
import {consumeWorkspacesRateLimit, pruneExpiredWorkspacesRateLimits} from '#db/rate-limits.js';
import {db} from './db.js';
import {workspacesRateLimits} from './schema/rate-limits.js';

describe('workspaces rate limits db', () => {
  it('atomically increments one bucket for concurrent attempts', async () => {
    const identifierHmac = `hmac-${crypto.randomUUID()}`;
    const params = {
      action: 'slug-availability',
      scope: 'ip',
      identifierHmac,
      windowStart: new Date('2026-06-23T00:00:00Z'),
      expiresAt: new Date('2026-06-23T00:01:00Z'),
      timeoutMs: 5_000,
    };

    await Promise.all(Array.from({length: 20}, () => consumeWorkspacesRateLimit(params)));

    const [row] = await db()
      .select({count: workspacesRateLimits.count})
      .from(workspacesRateLimits)
      .where(eq(workspacesRateLimits.identifierHmac, identifierHmac));
    expect(row?.count).toBe(20);
  });

  it('prunes expired counters and keeps active counters', async () => {
    const expiredIdentifierHmac = `expired-${crypto.randomUUID()}`;
    const activeIdentifierHmac = `active-${crypto.randomUUID()}`;
    await db()
      .insert(workspacesRateLimits)
      .values([
        {
          action: 'slug-availability',
          scope: 'ip',
          identifierHmac: expiredIdentifierHmac,
          windowStart: new Date('2026-06-23T00:00:00Z'),
          count: 1,
          expiresAt: new Date('2026-06-23T00:01:00Z'),
        },
        {
          action: 'slug-availability',
          scope: 'ip',
          identifierHmac: activeIdentifierHmac,
          windowStart: new Date('2026-06-23T00:04:00Z'),
          count: 1,
          expiresAt: new Date('2026-06-23T00:06:00Z'),
        },
      ]);

    const result = await pruneExpiredWorkspacesRateLimits({
      now: new Date('2026-06-23T00:05:00Z'),
      minIntervalMs: 0,
    });

    expect(result).toBeGreaterThanOrEqual(1);
    expect(await countBucket(expiredIdentifierHmac)).toBe(0);
    expect(await countBucket(activeIdentifierHmac)).toBe(1);
  });

  async function countBucket(identifierHmac: string): Promise<number> {
    const [row] = await db()
      .select({count: sql<number>`count(*)::int`})
      .from(workspacesRateLimits)
      .where(
        and(
          eq(workspacesRateLimits.action, 'slug-availability'),
          eq(workspacesRateLimits.scope, 'ip'),
          eq(workspacesRateLimits.identifierHmac, identifierHmac),
        ),
      );
    return row?.count ?? 0;
  }
});
