import {eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {workspacesRateLimits} from '#db/schema/rate-limits.js';
import {
  checkWorkspacesRateLimit,
  hashWorkspacesRateLimitIdentifier,
  WorkspacesRateLimitUnavailableError,
} from './rate-limit.js';

const HMAC_HEX_PATTERN = /^[a-f0-9]{64}$/;

describe('checkWorkspacesRateLimit', () => {
  it('hashes identifiers without storing the raw identifier', async () => {
    const identifier = `ip-${crypto.randomUUID()}`;
    const identifierHmac = hashWorkspacesRateLimitIdentifier({
      action: 'slug-availability',
      scope: 'ip',
      identifier,
    });

    await checkWorkspacesRateLimit({
      action: 'slug-availability',
      scope: 'ip',
      identifier,
      limit: 1,
      windowSeconds: 60,
      now: new Date('2026-06-23T00:00:10Z'),
    });

    const rows = await db()
      .select({identifierHmac: workspacesRateLimits.identifierHmac})
      .from(workspacesRateLimits)
      .where(eq(workspacesRateLimits.identifierHmac, identifierHmac));

    expect(identifierHmac).toMatch(HMAC_HEX_PATTERN);
    expect(identifierHmac).not.toContain(identifier);
    expect(rows).toEqual([{identifierHmac}]);
  });

  it('rejects the first over-limit attempt with retry-after seconds', async () => {
    const identifier = `ip-${crypto.randomUUID()}`;
    const now = new Date('2026-06-23T00:00:10Z');

    await checkWorkspacesRateLimit({
      action: 'slug-availability',
      scope: 'ip',
      identifier,
      limit: 2,
      windowSeconds: 60,
      now,
    });
    await checkWorkspacesRateLimit({
      action: 'slug-availability',
      scope: 'ip',
      identifier,
      limit: 2,
      windowSeconds: 60,
      now,
    });
    const result = checkWorkspacesRateLimit({
      action: 'slug-availability',
      scope: 'ip',
      identifier,
      limit: 2,
      windowSeconds: 60,
      now,
    });

    await expect(result).rejects.toMatchObject({
      name: 'WorkspacesRateLimitExceededError',
      retryAfterSeconds: 50,
    });
  });

  it('fails closed when the limiter query times out', async () => {
    const identifier = `ip-${crypto.randomUUID()}`;
    const identifierHmac = hashWorkspacesRateLimitIdentifier({
      action: 'slug-availability',
      scope: 'ip',
      identifier,
    });
    await db()
      .insert(workspacesRateLimits)
      .values({
        action: 'slug-availability',
        scope: 'ip',
        identifierHmac,
        windowStart: new Date('2026-06-23T00:03:00Z'),
        count: 1,
        expiresAt: new Date('2026-06-23T00:04:00Z'),
      });

    await db().transaction(async (tx) => {
      await tx.execute(sql`
        SELECT 1
        FROM workspaces_rate_limits
        WHERE identifier_hmac = ${identifierHmac}
        FOR UPDATE
      `);
      const result = checkWorkspacesRateLimit({
        action: 'slug-availability',
        scope: 'ip',
        identifier,
        limit: 1,
        windowSeconds: 60,
        now: new Date('2026-06-23T00:03:30Z'),
        timeoutMs: 10,
      });

      await expect(result).rejects.toBeInstanceOf(WorkspacesRateLimitUnavailableError);
    });
  });
});
