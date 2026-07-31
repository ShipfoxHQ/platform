import {sql} from 'drizzle-orm';
import {
  hashWorkspacesRateLimitIdentifier,
  WORKSPACE_SLUG_AVAILABILITY_RATE_LIMIT,
} from '#core/rate-limit.js';
import {createWorkspaceForUser} from '#core/workspaces.js';
import {db} from '#db/db.js';
import {workspacesRateLimits} from '#db/schema/rate-limits.js';
import {createWorkspacesTestApp, signupVerifyLogin} from '#test/routes.js';

let ipSequence = 1;

function uniqueIp(): string {
  ipSequence += 1;
  return `203.0.113.${ipSequence}`;
}

function windowStartFor(now: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

describe('GET /workspaces/slug-availability', () => {
  test('returns true for an available slug and false for a taken slug', async () => {
    const app = await createWorkspacesTestApp({fastifyOptions: {trustProxy: true}});
    const user = await signupVerifyLogin(app, 'workspace-slug-availability');
    const takenSlug = `taken-${crypto.randomUUID().slice(0, 8)}`;
    await createWorkspaceForUser({
      name: 'Taken Workspace',
      slug: takenSlug,
      userId: crypto.randomUUID(),
    });

    const headers = {
      authorization: `Bearer ${user.token}`,
      'x-forwarded-for': uniqueIp(),
    };
    const available = await app.inject({
      method: 'GET',
      url: `/workspaces/slug-availability?slug=available-${crypto.randomUUID().slice(0, 8)}`,
      headers,
    });
    const taken = await app.inject({
      method: 'GET',
      url: `/workspaces/slug-availability?slug=${takenSlug}`,
      headers: {...headers, 'x-forwarded-for': uniqueIp()},
    });

    expect(available.statusCode).toBe(200);
    expect(available.json()).toEqual({available: true});
    expect(taken.statusCode).toBe(200);
    expect(taken.json()).toEqual({available: false});

    await app.close();
  });

  test('rejects malformed slugs instead of reporting them as taken', async () => {
    const app = await createWorkspacesTestApp({fastifyOptions: {trustProxy: true}});
    const user = await signupVerifyLogin(app, 'workspace-slug-invalid');

    const res = await app.inject({
      method: 'GET',
      url: '/workspaces/slug-availability?slug=Not%20A%20Slug',
      headers: {
        authorization: `Bearer ${user.token}`,
        'x-forwarded-for': uniqueIp(),
      },
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });

  test('rejects unauthenticated callers', async () => {
    const app = await createWorkspacesTestApp({fastifyOptions: {trustProxy: true}});

    const res = await app.inject({
      method: 'GET',
      url: '/workspaces/slug-availability?slug=available',
    });

    expect(res.statusCode).toBe(401);

    await app.close();
  });

  test('rate-limits repeated availability checks by source IP', async () => {
    const app = await createWorkspacesTestApp({fastifyOptions: {trustProxy: true}});
    const user = await signupVerifyLogin(app, 'workspace-slug-rate-limit');
    const headers = {
      authorization: `Bearer ${user.token}`,
      'x-forwarded-for': uniqueIp(),
    };
    const url = `/workspaces/slug-availability?slug=rate-limit-${crypto.randomUUID().slice(0, 8)}`;
    let lastResponse = await app.inject({method: 'GET', url, headers});

    for (let attempt = 1; attempt <= WORKSPACE_SLUG_AVAILABILITY_RATE_LIMIT.limit; attempt += 1) {
      lastResponse = await app.inject({method: 'GET', url, headers});
    }

    expect(lastResponse.statusCode).toBe(429);
    expect(lastResponse.json()).toMatchObject({
      code: 'rate-limited',
      details: {retry_after_seconds: expect.any(Number)},
    });
    expect(lastResponse.headers['retry-after']).toEqual(expect.any(String));

    await app.close();
  });

  test('fails closed when limiter storage is unavailable', async () => {
    const app = await createWorkspacesTestApp({fastifyOptions: {trustProxy: true}});
    const user = await signupVerifyLogin(app, 'workspace-slug-rate-limit-unavailable');
    const ip = uniqueIp();
    const now = new Date();
    const windowStart = windowStartFor(now, WORKSPACE_SLUG_AVAILABILITY_RATE_LIMIT.windowSeconds);
    const identifierHmac = hashWorkspacesRateLimitIdentifier({
      action: 'slug-availability',
      scope: 'ip',
      identifier: ip,
    });

    await db()
      .insert(workspacesRateLimits)
      .values({
        action: 'slug-availability',
        scope: 'ip',
        identifierHmac,
        windowStart,
        count: 1,
        expiresAt: new Date(
          windowStart.getTime() + WORKSPACE_SLUG_AVAILABILITY_RATE_LIMIT.windowSeconds * 1000,
        ),
      });

    await db().transaction(async (tx) => {
      await tx.execute(sql`
        SELECT 1
        FROM workspaces_rate_limits
        WHERE identifier_hmac = ${identifierHmac}
        FOR UPDATE
      `);
      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/slug-availability?slug=unavailable-${crypto.randomUUID().slice(0, 8)}`,
        headers: {
          authorization: `Bearer ${user.token}`,
          'x-forwarded-for': ip,
        },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({code: 'workspace-rate-limit-unavailable'});
    });

    await app.close();
  });
});
