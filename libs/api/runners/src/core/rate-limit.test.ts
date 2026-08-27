import {vi} from '@shipfox/vitest/vi';
import {eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {runnersRateLimits} from '#db/schema/rate-limits.js';
import {
  checkRunnersRateLimit,
  hashRunnersRateLimitIdentifier,
  RunnersRateLimitUnavailableError,
} from './rate-limit.js';

const HMAC_HEX_PATTERN = /^[a-f0-9]{64}$/;

describe('checkRunnersRateLimit', () => {
  it('hashes identifiers without storing the raw identifier', async () => {
    const identifier = `provisioner-${crypto.randomUUID()}`;
    const identifierHmac = hashRunnersRateLimitIdentifier({
      action: 'provisioner-mint',
      scope: 'provisioner',
      identifier,
    });

    await checkRunnersRateLimit({
      action: 'provisioner-mint',
      scope: 'provisioner',
      identifier,
      limit: 1,
      windowSeconds: 60,
      now: new Date('2026-06-23T00:00:10Z'),
    });

    const rows = await db()
      .select({identifierHmac: runnersRateLimits.identifierHmac})
      .from(runnersRateLimits)
      .where(eq(runnersRateLimits.identifierHmac, identifierHmac));
    expect(identifierHmac).toMatch(HMAC_HEX_PATTERN);
    expect(identifierHmac).not.toContain(identifier);
    expect(rows).toEqual([{identifierHmac}]);
  });

  it('fails closed when the limiter query times out', async () => {
    const identifier = `provisioner-${crypto.randomUUID()}`;
    const identifierHmac = hashRunnersRateLimitIdentifier({
      action: 'provisioner-mint',
      scope: 'provisioner',
      identifier,
    });
    await db()
      .insert(runnersRateLimits)
      .values({
        action: 'provisioner-mint',
        scope: 'provisioner',
        identifierHmac,
        windowStart: new Date('2026-06-23T00:03:00Z'),
        count: 1,
        expiresAt: new Date('2026-06-23T00:04:00Z'),
      });

    await db().transaction(async (tx) => {
      await tx.execute(sql`
        SELECT 1
        FROM runners_rate_limits
        WHERE identifier_hmac = ${identifierHmac}
        FOR UPDATE
      `);
      const result = checkRunnersRateLimit({
        action: 'provisioner-mint',
        scope: 'provisioner',
        identifier,
        limit: 1,
        windowSeconds: 60,
        now: new Date('2026-06-23T00:03:30Z'),
        timeoutMs: 10,
      });

      await expect(result).rejects.toBeInstanceOf(RunnersRateLimitUnavailableError);
    });
  });

  it('uses the root-derived identifier key', async () => {
    vi.resetModules();
    vi.stubEnv('AUTH_ROOT_KEY', 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=');

    try {
      const firstModule = await import('./rate-limit.js');
      const firstHash = firstModule.hashRunnersRateLimitIdentifier({
        action: 'provisioner-mint',
        scope: 'provisioner',
        identifier: 'provisioner-token-id',
      });
      vi.stubEnv('AUTH_ROOT_KEY', 'ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=');
      vi.resetModules();
      const secondModule = await import('./rate-limit.js');
      const secondHash = secondModule.hashRunnersRateLimitIdentifier({
        action: 'provisioner-mint',
        scope: 'provisioner',
        identifier: 'provisioner-token-id',
      });

      expect(firstHash).toMatch(HMAC_HEX_PATTERN);
      expect(secondHash).toMatch(HMAC_HEX_PATTERN);
      expect(firstHash).not.toBe(secondHash);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
