import {ADMINISTRATION_ACTION_PERFORMED} from '@shipfox/api-common-dto';
import {eq, sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {type AuthRateLimitAction, hashAuthRateLimitIdentifier} from '#core/rate-limit.js';
import {db} from '#db/db.js';
import {authOutbox} from '#db/schema/outbox.js';
import {authRateLimits} from '#db/schema/rate-limits.js';
import {refreshTokens} from '#db/schema/refresh-tokens.js';
import {users} from '#db/schema/users.js';
import {
  cookieHeader,
  createAuthTestApp,
  createVerifiedSession,
  getSetCookie,
  login,
  resetCapturedMail,
} from '#test/routes.js';

const BOOTSTRAP_TOKEN = 'test-bootstrap-token';

async function resetAdministrationState(): Promise<void> {
  await db().execute(
    sql`TRUNCATE auth_admin_command_results, auth_admin_grants, auth_outbox, auth_rate_limits CASCADE`,
  );
}

function authHeaders(token: string, idempotencyKey: string) {
  return {
    authorization: `Bearer ${token}`,
    'idempotency-key': idempotencyKey,
  };
}

async function seedExhaustedIpBucket(params: {
  action: AuthRateLimitAction;
  identifier: string;
  limit: number;
  windowSeconds: number;
}): Promise<void> {
  const windowMs = params.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  await db()
    .insert(authRateLimits)
    .values({
      action: params.action,
      scope: 'ip',
      identifierHmac: hashAuthRateLimitIdentifier({
        action: params.action,
        scope: 'ip',
        identifier: params.identifier,
      }),
      windowStart,
      count: params.limit,
      expiresAt: new Date(windowStart.getTime() + windowMs),
    });
}

describe('Auth administration routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createAuthTestApp();
  });

  beforeEach(async () => {
    resetCapturedMail();
    await resetAdministrationState();
  });

  afterAll(async () => {
    await resetAdministrationState();
    await app.close();
  });

  test('requires an authenticated session for bootstrap', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: {'idempotency-key': 'anonymous-bootstrap'},
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });

    expect(response.statusCode).toBe(401);
  });

  test('requires an authenticated session for bootstrap state', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/auth/bootstrap-state',
    });

    expect(response.statusCode).toBe(401);
  });

  test('reports only available or closed bootstrap state', async () => {
    const account = await createVerifiedSession('admin-bootstrap-state');

    const available = await app.inject({
      method: 'GET',
      url: '/admin/auth/bootstrap-state',
      headers: {authorization: `Bearer ${account.token}`},
    });

    expect(available.statusCode).toBe(200);
    expect(available.json()).toEqual({state: 'available'});

    const bootstrap = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(account.token, 'bootstrap-state-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    expect(bootstrap.statusCode).toBe(201);

    const closed = await app.inject({
      method: 'GET',
      url: '/admin/auth/bootstrap-state',
      headers: {authorization: `Bearer ${account.token}`},
    });

    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toEqual({state: 'closed'});
    expect(JSON.stringify(closed.json())).not.toContain(BOOTSTRAP_TOKEN);
  });

  test('keeps bootstrap-state reads separate from the bootstrap write limit', async () => {
    const account = await createVerifiedSession('admin-bootstrap-state-rate-limit');
    const ip = '127.0.0.1';

    await seedExhaustedIpBucket({
      action: 'bootstrap',
      identifier: ip,
      limit: 5,
      windowSeconds: 15 * 60,
    });
    const state = await app.inject({
      method: 'GET',
      url: '/admin/auth/bootstrap-state',
      headers: {authorization: `Bearer ${account.token}`},
    });
    expect(state.statusCode).toBe(200);

    await resetAdministrationState();
    await seedExhaustedIpBucket({
      action: 'bootstrap-state',
      identifier: ip,
      limit: 60,
      windowSeconds: 5 * 60,
    });
    const blocked = await app.inject({
      method: 'GET',
      url: '/admin/auth/bootstrap-state',
      headers: {authorization: `Bearer ${account.token}`},
    });
    expect(blocked.statusCode).toBe(429);
  });

  test('does not register the removed versioned administration namespace', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/v1/auth/users?user_id=00000000-0000-4000-8000-000000000000',
    });

    expect(response.statusCode).toBe(404);
  });

  test('rejects an invalid bootstrap token without writing a grant or event', async () => {
    const account = await createVerifiedSession('admin-bootstrap-invalid');

    const response = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(account.token, 'invalid-bootstrap'),
      payload: {bootstrap_token: 'wrong-token'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('bootstrap-token-invalid');
    await expect(db().select().from(authOutbox)).resolves.toHaveLength(0);
  });

  test('rate-limits repeated bootstrap attempts by source IP', async () => {
    const account = await createVerifiedSession('admin-bootstrap-rate-limit');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/auth/admin-grants/bootstrap',
        headers: authHeaders(account.token, `bootstrap-rate-limit-${attempt}`),
        payload: {bootstrap_token: 'wrong-token'},
      });
      expect(response.statusCode).toBe(403);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(account.token, 'bootstrap-rate-limit-blocked'),
      payload: {bootstrap_token: 'wrong-token'},
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('rate-limited');
  });

  test('bootstraps exactly one owner and permanently closes bootstrap', async () => {
    const first = await createVerifiedSession('admin-bootstrap-first');
    const second = await createVerifiedSession('admin-bootstrap-second');

    const response = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(first.token, 'bootstrap-first'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({user_id: first.userId, role: 'admin-owner'});

    const repeated = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(first.token, 'bootstrap-first'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    expect(repeated.statusCode).toBe(201);
    expect(repeated.json().id).toBe(response.json().id);

    const secondAttempt = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(second.token, 'bootstrap-second'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    expect(secondAttempt.statusCode).toBe(409);
    expect(secondAttempt.json().code).toBe('bootstrap-closed');

    const events = await db().select().from(authOutbox);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe(ADMINISTRATION_ACTION_PERFORMED);
    expect(events[0]?.payload).toMatchObject({
      actorId: first.userId,
      actorRole: 'admin-owner',
      requiredRole: 'admin-owner',
      command: 'auth.admin_grant.bootstrap',
      result: 'succeeded',
    });
    expect(JSON.stringify(events[0]?.payload)).not.toContain(BOOTSTRAP_TOKEN);
  });

  test('serializes concurrent bootstrap attempts to one active first owner', async () => {
    const first = await createVerifiedSession('admin-bootstrap-race-first');
    const second = await createVerifiedSession('admin-bootstrap-race-second');

    const responses = await Promise.all(
      [first, second].map((account, index) =>
        app.inject({
          method: 'POST',
          url: '/admin/auth/admin-grants/bootstrap',
          headers: authHeaders(account.token, `bootstrap-race-${index}`),
          payload: {bootstrap_token: BOOTSTRAP_TOKEN},
        }),
      ),
    );

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const activeOwnerRoles = await Promise.all(
      [first, second].map(async (account) => {
        const response = await app.inject({
          method: 'GET',
          url: `/admin/auth/users?user_id=${account.userId}`,
          headers: {authorization: `Bearer ${account.token}`},
        });
        return response.statusCode === 200 && response.json().admin_role === 'admin-owner';
      }),
    );

    expect(activeOwnerRoles.filter(Boolean)).toHaveLength(1);
  });

  test('lets an owner list, grant, and revoke roles with idempotent audited mutations', async () => {
    const owner = await createVerifiedSession('admin-grant-owner');
    const target = await createVerifiedSession('admin-grant-target');

    const bootstrap = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'grant-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    expect(bootstrap.statusCode).toBe(201);

    const grant = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'grant-observer'),
      payload: {
        user_id: target.userId,
        role: 'admin-observer',
        reason: 'Support investigation',
      },
    });
    expect(grant.statusCode).toBe(201);

    const repeatedGrant = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'grant-observer'),
      payload: {
        user_id: target.userId,
        role: 'admin-observer',
        reason: 'Support investigation',
      },
    });
    expect(repeatedGrant.statusCode).toBe(201);
    expect(repeatedGrant.json().id).toBe(grant.json().id);

    const grants = await app.inject({
      method: 'GET',
      url: '/admin/auth/admin-grants',
      headers: {authorization: `Bearer ${owner.token}`},
    });
    expect(grants.statusCode).toBe(200);
    expect(grants.json().grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({user: expect.objectContaining({id: target.userId})}),
      ]),
    );

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/admin/auth/admin-grants/${grant.json().id}`,
      headers: authHeaders(owner.token, 'revoke-observer'),
      payload: {reason: 'Support investigation complete'},
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({id: grant.json().id, revoked_at: expect.any(String)});

    const repeatedRevoke = await app.inject({
      method: 'DELETE',
      url: `/admin/auth/admin-grants/${grant.json().id}`,
      headers: authHeaders(owner.token, 'revoke-observer'),
      payload: {reason: 'Support investigation complete'},
    });
    expect(repeatedRevoke.statusCode).toBe(200);
    expect(repeatedRevoke.json().revoked_at).toBe(revoked.json().revoked_at);

    const events = await db().select().from(authOutbox);
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.eventType)).toEqual(
      Array(3).fill(ADMINISTRATION_ACTION_PERFORMED),
    );
  });

  test('lets an observer find exact IDs and normalized emails without exposing user secrets', async () => {
    const owner = await createVerifiedSession('admin-user-lookup-owner');
    const observer = await createVerifiedSession('admin-user-lookup-observer');

    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'user-lookup-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'user-lookup-grant'),
      payload: {
        user_id: observer.userId,
        role: 'admin-observer',
        reason: 'Support lookup access',
      },
    });

    const byId = await app.inject({
      method: 'GET',
      url: `/admin/auth/users?user_id=${observer.userId}`,
      headers: {authorization: `Bearer ${observer.token}`},
    });

    expect(byId.statusCode).toBe(200);
    expect(byId.json()).toEqual({
      id: observer.userId,
      email: observer.email,
      name: 'admin-user-lookup-observer',
      status: 'active',
      email_verified_at: expect.any(String),
      created_at: expect.any(String),
      admin_role: 'admin-observer',
    });
    expect(byId.json()).not.toHaveProperty('hashed_password');
    expect(byId.json()).not.toHaveProperty('sessions');
    expect(byId.json()).not.toHaveProperty('provider_payload');

    const byEmail = await app.inject({
      method: 'GET',
      url: `/admin/auth/users?email=${encodeURIComponent(` ${observer.email.toUpperCase()} `)}`,
      headers: {authorization: `Bearer ${observer.token}`},
    });

    expect(byEmail.statusCode).toBe(200);
    expect(byEmail.json().id).toBe(observer.userId);
    expect(byEmail.json().email).toBe(observer.email);
  });

  test('bounds and deterministically paginates administrator grant summaries for observers', async () => {
    const owner = await createVerifiedSession('admin-summary-owner');
    const observer = await createVerifiedSession('admin-summary-observer');

    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'summary-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    const grant = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'summary-grant'),
      payload: {
        user_id: observer.userId,
        role: 'admin-observer',
        reason: 'Read-only support access',
      },
    });

    const firstPage = await app.inject({
      method: 'GET',
      url: '/admin/auth/admin-grants?limit=1',
      headers: {authorization: `Bearer ${observer.token}`},
    });

    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().grants).toHaveLength(1);
    expect(firstPage.json().grants[0]).toEqual({
      grant_id: grant.json().id,
      role: 'admin-observer',
      created_at: expect.any(String),
      revoked_at: null,
      user: {
        id: observer.userId,
        email: observer.email,
        name: 'admin-summary-observer',
        status: 'active',
      },
    });
    expect(firstPage.json().next_cursor).toEqual(expect.any(String));

    const secondPage = await app.inject({
      method: 'GET',
      url: `/admin/auth/admin-grants?limit=1&cursor=${firstPage.json().next_cursor}`,
      headers: {authorization: `Bearer ${observer.token}`},
    });

    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json().grants).toHaveLength(1);
    expect(secondPage.json().grants[0].user.id).toBe(owner.userId);
    expect(secondPage.json().next_cursor).toBeNull();
  });

  test('rejects ordinary users and unchecked user lookup filters', async () => {
    const ordinary = await createVerifiedSession('admin-lookup-ordinary');

    const forbidden = await app.inject({
      method: 'GET',
      url: `/admin/auth/users?id=${ordinary.userId}`,
      headers: {authorization: `Bearer ${ordinary.token}`},
    });
    expect(forbidden.statusCode).toBe(403);

    const missingFilter = await app.inject({
      method: 'GET',
      url: '/admin/auth/users',
      headers: {authorization: `Bearer ${ordinary.token}`},
    });
    expect(missingFilter.statusCode).toBe(400);

    const multipleFilters = await app.inject({
      method: 'GET',
      url: `/admin/auth/users?id=${ordinary.userId}&email=${encodeURIComponent(ordinary.email)}`,
      headers: {authorization: `Bearer ${ordinary.token}`},
    });
    expect(multipleFilters.statusCode).toBe(400);
  });

  test('returns 404 for a well-formed but unknown user lookup', async () => {
    const owner = await createVerifiedSession('admin-lookup-unknown-owner');
    const observer = await createVerifiedSession('admin-lookup-unknown-observer');

    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'unknown-lookup-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'unknown-lookup-grant'),
      payload: {
        user_id: observer.userId,
        role: 'admin-observer',
        reason: 'Support lookup access',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/admin/auth/users?user_id=00000000-0000-4000-8000-000000000000',
      headers: {authorization: `Bearer ${observer.token}`},
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('not-found');
  });

  test('rejects a malformed pagination cursor', async () => {
    const owner = await createVerifiedSession('admin-grants-bad-cursor-owner');
    const observer = await createVerifiedSession('admin-grants-bad-cursor-observer');

    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'bad-cursor-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'bad-cursor-grant'),
      payload: {
        user_id: observer.userId,
        role: 'admin-observer',
        reason: 'Support lookup access',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/admin/auth/admin-grants?cursor=not-a-real-cursor',
      headers: {authorization: `Bearer ${observer.token}`},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('invalid-cursor');
  });

  test('rate-limits repeated user lookups by source IP', async () => {
    const owner = await createVerifiedSession('admin-lookup-rate-limit-owner');
    const observer = await createVerifiedSession('admin-lookup-rate-limit-observer');

    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'lookup-rate-limit-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'lookup-rate-limit-grant'),
      payload: {
        user_id: observer.userId,
        role: 'admin-observer',
        reason: 'Support lookup access',
      },
    });

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await app.inject({
        method: 'GET',
        url: `/admin/auth/users?user_id=${observer.userId}`,
        headers: {authorization: `Bearer ${observer.token}`},
      });
      expect(response.statusCode).toBe(200);
    }

    const blocked = await app.inject({
      method: 'GET',
      url: `/admin/auth/users?user_id=${observer.userId}`,
      headers: {authorization: `Bearer ${observer.token}`},
    });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('rate-limited');
  });

  test('checks the administrator role before consuming the lookup IP bucket', async () => {
    const owner = await createVerifiedSession('admin-lookup-authz-order-owner');
    const observer = await createVerifiedSession('admin-lookup-authz-order-observer');
    const ordinary = await createVerifiedSession('admin-lookup-authz-order-ordinary');

    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'authz-order-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'authz-order-grant'),
      payload: {
        user_id: observer.userId,
        role: 'admin-observer',
        reason: 'Support lookup access',
      },
    });

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await app.inject({
        method: 'GET',
        url: `/admin/auth/users?user_id=${ordinary.userId}`,
        headers: {authorization: `Bearer ${ordinary.token}`},
      });
      expect(response.statusCode).toBe(403);
    }

    const observerResponse = await app.inject({
      method: 'GET',
      url: `/admin/auth/users?user_id=${observer.userId}`,
      headers: {authorization: `Bearer ${observer.token}`},
    });
    expect(observerResponse.statusCode).toBe(200);
  });

  test('protects the final active owner and rejects idempotency-key reuse', async () => {
    const owner = await createVerifiedSession('admin-final-owner');
    const target = await createVerifiedSession('admin-final-target');

    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'final-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });

    const firstGrant = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'role-key'),
      payload: {user_id: target.userId, role: 'admin-observer', reason: 'Initial review'},
    });
    expect(firstGrant.statusCode).toBe(201);

    const reusedKey = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'role-key'),
      payload: {user_id: target.userId, role: 'admin-operator', reason: 'Different command'},
    });
    expect(reusedKey.statusCode).toBe(409);
    expect(reusedKey.json().code).toBe('idempotency-key-reused');

    const finalOwnerRevoke = await app.inject({
      method: 'DELETE',
      url: `/admin/auth/admin-grants/${
        (
          await app.inject({
            method: 'GET',
            url: '/admin/auth/admin-grants',
            headers: {authorization: `Bearer ${owner.token}`},
          })
        )
          .json()
          .grants.find((grant: {user: {id: string}}) => grant.user.id === owner.userId).grant_id
      }`,
      headers: authHeaders(owner.token, 'revoke-final-owner'),
      payload: {reason: 'Attempt to remove final owner'},
    });
    expect(finalOwnerRevoke.statusCode).toBe(409);
    expect(finalOwnerRevoke.json().code).toBe('last-owner');
  });

  test('suspends users, invalidates sessions, and reactivates without restoring them', async () => {
    const owner = await createVerifiedSession('admin-user-moderation-owner');
    const target = await createVerifiedSession('admin-user-moderation-target');

    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'moderation-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'moderation-grant'),
      payload: {
        user_id: owner.userId,
        role: 'admin-operator',
        reason: 'User moderation access',
      },
    });

    const rotatedBeforeSuspension = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: target.refreshCookie},
      payload: {},
    });
    expect(rotatedBeforeSuspension.statusCode).toBe(200);
    const rotatedRefreshCookie = cookieHeader(getSetCookie(rotatedBeforeSuspension));

    const suspended = await app.inject({
      method: 'POST',
      url: `/admin/auth/users/${target.userId}/suspend`,
      headers: authHeaders(owner.token, 'suspend-user'),
      payload: {reason: 'Account security review'},
    });

    expect(suspended.statusCode).toBe(200);
    expect(suspended.json()).toMatchObject({
      id: target.userId,
      status: 'suspended',
      admin_role: null,
      correlation_id: expect.any(String),
    });

    const suspendedMe = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {authorization: `Bearer ${target.token}`},
    });
    const suspendedLogin = await login(app, {email: target.email, password: target.password});
    expect(suspendedMe.statusCode).toBe(401);
    expect(suspendedLogin.statusCode).toBe(401);

    const suspendedDbUser = (
      await db().select({status: users.status}).from(users).where(eq(users.id, target.userId))
    )[0];
    const targetSessions = await db()
      .select({sessionId: refreshTokens.sessionId, revokedAt: refreshTokens.revokedAt})
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, target.userId));
    expect(suspendedDbUser?.status).toBe('suspended');
    expect(targetSessions).toHaveLength(2);
    expect(targetSessions.every(({revokedAt}) => revokedAt instanceof Date)).toBe(true);

    const suspendedRefresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: rotatedRefreshCookie},
      payload: {},
    });
    expect(suspendedRefresh.statusCode).toBe(401);

    const suspensionEvent = (await db().select().from(authOutbox)).find(
      (event) =>
        event.eventType === ADMINISTRATION_ACTION_PERFORMED &&
        (event.payload as {command?: string}).command === 'auth.user.suspend',
    );
    expect(suspensionEvent?.payload).toMatchObject({
      actorId: owner.userId,
      actorRole: 'admin-owner',
      requiredRole: 'admin-operator',
      targetId: target.userId,
      reason: 'Account security review',
      result: 'succeeded',
    });
    expect(JSON.stringify(suspensionEvent?.payload)).not.toContain('suspend-user');
    expect(JSON.stringify(suspensionEvent?.payload)).not.toContain(target.password);

    const repeatedSuspension = await app.inject({
      method: 'POST',
      url: `/admin/auth/users/${target.userId}/suspend`,
      headers: authHeaders(owner.token, 'suspend-user'),
      payload: {reason: 'Account security review'},
    });
    expect(repeatedSuspension.statusCode).toBe(200);
    expect(repeatedSuspension.json().correlation_id).toBe(suspended.json().correlation_id);

    const reusedSuspensionKey = await app.inject({
      method: 'POST',
      url: `/admin/auth/users/${target.userId}/suspend`,
      headers: authHeaders(owner.token, 'suspend-user'),
      payload: {reason: 'A different reason'},
    });
    expect(reusedSuspensionKey.statusCode).toBe(409);
    expect(reusedSuspensionKey.json().code).toBe('idempotency-key-reused');

    const reactivated = await app.inject({
      method: 'POST',
      url: `/admin/auth/users/${target.userId}/reactivate`,
      headers: authHeaders(owner.token, 'reactivate-user'),
      payload: {},
    });
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json()).toMatchObject({
      id: target.userId,
      status: 'active',
      correlation_id: expect.any(String),
    });

    const oldRefreshAfterReactivation = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: target.refreshCookie},
      payload: {},
    });
    expect(oldRefreshAfterReactivation.statusCode).toBe(401);
    const rotatedRefreshAfterReactivation = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: rotatedRefreshCookie},
      payload: {},
    });
    expect(rotatedRefreshAfterReactivation.statusCode).toBe(401);

    const newLogin = await login(app, {email: target.email, password: target.password});
    expect(newLogin.statusCode).toBe(200);
    const secondLogin = await login(app, {email: target.email, password: target.password});
    expect(secondLogin.statusCode).toBe(200);

    const revoked = await app.inject({
      method: 'POST',
      url: `/admin/auth/users/${target.userId}/revoke-sessions`,
      headers: authHeaders(owner.token, 'revoke-user-sessions'),
      payload: {reason: 'End all active sessions'},
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({
      id: target.userId,
      status: 'active',
      sessions_revoked: 2,
      correlation_id: expect.any(String),
    });

    const newRefresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: cookieHeader(getSetCookie(newLogin))},
      payload: {},
    });
    expect(newRefresh.statusCode).toBe(401);
    const secondRefresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: cookieHeader(getSetCookie(secondLogin))},
      payload: {},
    });
    expect(secondRefresh.statusCode).toBe(401);

    const repeatedRevoke = await app.inject({
      method: 'POST',
      url: `/admin/auth/users/${target.userId}/revoke-sessions`,
      headers: authHeaders(owner.token, 'revoke-user-sessions'),
      payload: {reason: 'End all active sessions'},
    });
    expect(repeatedRevoke.statusCode).toBe(200);
    expect(repeatedRevoke.json().sessions_revoked).toBe(2);
    expect(repeatedRevoke.json().correlation_id).toBe(revoked.json().correlation_id);
  });

  test('protects the final active owner from suspension', async () => {
    const owner = await createVerifiedSession('admin-suspend-final-owner');

    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'suspend-final-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });

    const suspended = await app.inject({
      method: 'POST',
      url: `/admin/auth/users/${owner.userId}/suspend`,
      headers: authHeaders(owner.token, 'suspend-final-owner'),
      payload: {reason: 'Attempt to suspend final owner'},
    });

    expect(suspended.statusCode).toBe(409);
    expect(suspended.json().code).toBe('last-owner');
  });

  test('rejects user moderation by an observer', async () => {
    const owner = await createVerifiedSession('admin-moderation-role-owner');
    const observer = await createVerifiedSession('admin-moderation-role-observer');
    const target = await createVerifiedSession('admin-moderation-role-target');

    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'moderation-role-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'moderation-role-grant'),
      payload: {
        user_id: observer.userId,
        role: 'admin-observer',
        reason: 'Read-only administration access',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/admin/auth/users/${target.userId}/suspend`,
      headers: authHeaders(observer.token, 'moderation-role-suspend'),
      payload: {reason: 'Observer should not mutate users'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('forbidden');
  });
});
