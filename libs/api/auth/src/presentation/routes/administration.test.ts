import {impersonateResponseSchema} from '@shipfox/api-auth-dto';
import {ADMINISTRATION_ACTION_PERFORMED} from '@shipfox/api-common-dto';
import {userAccessTokenKey} from '@shipfox/node-auth-root-key';
import type {AppConfig, FastifyInstance} from '@shipfox/node-fastify';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {asc, eq, sql} from 'drizzle-orm';
import {signUserToken, verifyUserToken} from '#core/jwt.js';
import {type AuthRateLimitAction, hashAuthRateLimitIdentifier} from '#core/rate-limit.js';
import {db} from '#db/db.js';
import {adminCommandResults} from '#db/schema/admin-command-results.js';
import {adminGrants} from '#db/schema/admin-grants.js';
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
  ROUTE_TEST_SECRET,
  resetCapturedMail,
  setAuthJwtExpiresIn,
  setImpersonationEnabled,
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

function impersonatedToken(userId: string, email: string): Promise<string> {
  return signUserToken({
    userId,
    email,
    name: 'Impersonated User',
    memberships: [],
    impersonatorId: crypto.randomUUID(),
    secret: ROUTE_TEST_SECRET,
    expiresIn: '15m',
  });
}

async function seedExhaustedIpBucket(params: {
  action: AuthRateLimitAction;
  identifier: string;
  limit: number;
  windowSeconds: number;
  scope?: 'ip' | 'actor';
}): Promise<void> {
  const scope = params.scope ?? 'ip';
  const windowMs = params.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  await db()
    .insert(authRateLimits)
    .values({
      action: params.action,
      scope,
      identifierHmac: hashAuthRateLimitIdentifier({
        action: params.action,
        scope,
        identifier: params.identifier,
      }),
      windowStart,
      count: params.limit,
      expiresAt: new Date(windowStart.getTime() + windowMs),
    });
}

type LoggerInstance = NonNullable<NonNullable<AppConfig['fastifyOptions']>['loggerInstance']>;

interface CapturedLog {
  level: string;
  args: unknown[];
}

function createCapturingLogger(logs: CapturedLog[]): LoggerInstance {
  const logger = {
    child: () => logger,
    level: 'info',
    silent: (...args: unknown[]) => logs.push({level: 'silent', args}),
    fatal: (...args: unknown[]) => logs.push({level: 'fatal', args}),
    error: (...args: unknown[]) => logs.push({level: 'error', args}),
    warn: (...args: unknown[]) => logs.push({level: 'warn', args}),
    info: (...args: unknown[]) => logs.push({level: 'info', args}),
    debug: (...args: unknown[]) => logs.push({level: 'debug', args}),
    trace: (...args: unknown[]) => logs.push({level: 'trace', args}),
  };
  return logger as unknown as LoggerInstance;
}

function directoryLogContexts(logs: CapturedLog[]): unknown[] {
  return logs
    .filter(
      ({level, args}) => level === 'info' && args[1] === 'Listed administrator user directory',
    )
    .map(({args}) => args[0]);
}

describe('Auth administration routes', () => {
  let app: FastifyInstance;
  const directoryLogs: CapturedLog[] = [];

  beforeAll(async () => {
    app = await createAuthTestApp({
      fastifyOptions: {loggerInstance: createCapturingLogger(directoryLogs)},
    });
  });

  beforeEach(async () => {
    directoryLogs.length = 0;
    resetCapturedMail();
    setImpersonationEnabled(true);
    setAuthJwtExpiresIn('15m');
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

  test('rejects an impersonated session on the bootstrap route before any side effect', async () => {
    const account = await createVerifiedSession('admin-bootstrap-impersonated');

    const response = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(
        await impersonatedToken(account.userId, account.email),
        'impersonated-bootstrap',
      ),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({code: 'admin-role-required'});
    await expect(db().select().from(adminGrants)).resolves.toHaveLength(0);
    await expect(db().select().from(authOutbox)).resolves.toHaveLength(0);
  });

  test('rejects an impersonated session on the bootstrap-state route', async () => {
    const account = await createVerifiedSession('admin-bootstrap-state-impersonated');

    const response = await app.inject({
      method: 'GET',
      url: '/admin/auth/bootstrap-state',
      headers: {authorization: `Bearer ${await impersonatedToken(account.userId, account.email)}`},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({code: 'admin-role-required'});
  });

  test('rejects an impersonated session on user administration before roles are consulted', async () => {
    const owner = await createVerifiedSession('admin-users-impersonated');

    const bootstrap = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'users-impersonated-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    expect(bootstrap.statusCode).toBe(201);

    const response = await app.inject({
      method: 'GET',
      url: `/admin/auth/users?user_id=${owner.userId}`,
      headers: {authorization: `Bearer ${await impersonatedToken(owner.userId, owner.email)}`},
    });

    // The impersonated subject is an owner, so a guard that consulted roles
    // would let the request through; rejection proves the mark wins first.
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({code: 'admin-role-required'});
  });

  test('rejects an impersonated session on the grant route before any side effect', async () => {
    const owner = await createVerifiedSession('admin-grant-impersonated');
    const target = await createVerifiedSession('admin-grant-impersonated-target');

    const bootstrap = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'grant-impersonated-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    expect(bootstrap.statusCode).toBe(201);

    const response = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(
        await impersonatedToken(owner.userId, owner.email),
        'impersonated-grant',
      ),
      payload: {user_id: target.userId, role: 'admin-observer', reason: 'Impersonated attempt'},
    });

    // The impersonated subject is an owner, so a guard that consulted roles
    // would let the grant through; rejection proves the mark wins first and
    // that no grant or audit event is left behind.
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({code: 'admin-role-required'});
    await expect(db().select().from(adminGrants)).resolves.toHaveLength(1);
    await expect(db().select().from(authOutbox)).resolves.toHaveLength(1);
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

    const directoryResponse = await app.inject({
      method: 'GET',
      url: '/admin/v1/auth/users/directory',
    });
    expect(directoryResponse.statusCode).toBe(404);
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

  test('lists safe user summaries for owners, operators, and observers with cursor pagination', async () => {
    const marker = `admin-user-directory-${crypto.randomUUID()}`;
    const owner = await createVerifiedSession(`${marker}-owner`);
    const operator = await createVerifiedSession(`${marker}-operator`);
    const observer = await createVerifiedSession(`${marker}-observer`);
    const target = await createVerifiedSession(`${marker}-target`);
    const eligibilityMarker = `admin-user-directory-eligibility-${crypto.randomUUID()}`;
    const eligibleTarget = await createVerifiedSession(`${eligibilityMarker}-eligible`);
    const ineligibleTarget = await createVerifiedSession(`${eligibilityMarker}-ineligible`);
    await db()
      .update(users)
      .set({status: 'suspended'})
      .where(eq(users.id, ineligibleTarget.userId));

    const bootstrap = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'directory-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    expect(bootstrap.statusCode).toBe(201);

    const observerGrant = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'directory-observer-grant'),
      payload: {
        user_id: observer.userId,
        role: 'admin-observer',
        reason: 'Directory read access',
      },
    });
    expect(observerGrant.statusCode).toBe(201);

    const operatorGrant = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'directory-operator-grant'),
      payload: {
        user_id: operator.userId,
        role: 'admin-operator',
        reason: 'Directory read access',
      },
    });
    expect(operatorGrant.statusCode).toBe(201);

    const firstPage = await app.inject({
      method: 'GET',
      url: `/admin/auth/users/directory?search=${encodeURIComponent(` ${marker}   `)}&limit=2`,
      headers: {authorization: `Bearer ${observer.token}`},
    });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().users).toHaveLength(2);
    expect(firstPage.json().next_cursor).toEqual(expect.any(String));
    const firstPageLog = directoryLogContexts(directoryLogs).at(-1);
    expect(firstPageLog).toMatchObject({
      actorId: observer.userId,
      requiredRole: 'admin-observer',
      targetType: 'user-directory',
      requestId: expect.any(String),
      result: 'succeeded',
      outcome: 'succeeded',
      durationMs: expect.any(Number),
      resultCountBucket: '1-10',
      filterPresence: {search: true, status: false, impersonationEligible: false},
      nextPagePresent: true,
    });
    expect(JSON.stringify(firstPageLog)).not.toContain(marker);
    expect(JSON.stringify(firstPageLog)).not.toContain(firstPage.json().next_cursor);

    const secondPage = await app.inject({
      method: 'GET',
      url: `/admin/auth/users/directory?search=${encodeURIComponent(marker)}&limit=2&cursor=${encodeURIComponent(firstPage.json().next_cursor)}`,
      headers: {authorization: `Bearer ${observer.token}`},
    });
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json().users).toHaveLength(2);
    expect(secondPage.json().next_cursor).toBeNull();

    const listedUsers = [...firstPage.json().users, ...secondPage.json().users];
    expect(new Set(listedUsers.map((user: {id: string}) => user.id)).size).toBe(4);
    expect(listedUsers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: owner.userId,
          email: owner.email,
          name: `${marker}-owner`,
          status: 'active',
          admin_role: 'admin-owner',
        }),
        expect.objectContaining({
          id: operator.userId,
          email: operator.email,
          name: `${marker}-operator`,
          status: 'active',
          admin_role: 'admin-operator',
        }),
        expect.objectContaining({
          id: observer.userId,
          email: observer.email,
          name: `${marker}-observer`,
          status: 'active',
          admin_role: 'admin-observer',
        }),
        expect.objectContaining({
          id: target.userId,
          email: target.email,
          name: `${marker}-target`,
          status: 'active',
          admin_role: null,
        }),
      ]),
    );
    for (const user of listedUsers) {
      expect(user).not.toHaveProperty('hashed_password');
      expect(user).not.toHaveProperty('sessions');
      expect(user).not.toHaveProperty('provider_payload');
    }

    const eligibleUsers = await app.inject({
      method: 'GET',
      url: `/admin/auth/users/directory?search=${encodeURIComponent(marker)}&status=active&impersonation_eligible=true`,
      headers: {authorization: `Bearer ${observer.token}`},
    });
    expect(eligibleUsers.statusCode).toBe(200);
    expect(eligibleUsers.json().users).toEqual([
      expect.objectContaining({id: target.userId, admin_role: null}),
    ]);
    expect(eligibleUsers.json().next_cursor).toBeNull();

    const ineligibleUsers = await app.inject({
      method: 'GET',
      url: `/admin/auth/users/directory?search=${encodeURIComponent(eligibilityMarker)}&impersonation_eligible=false`,
      headers: {authorization: `Bearer ${observer.token}`},
    });
    expect(ineligibleUsers.statusCode).toBe(200);
    expect(ineligibleUsers.json().users).toEqual([
      expect.objectContaining({id: ineligibleTarget.userId, status: 'suspended'}),
    ]);
    expect(ineligibleUsers.json().users).not.toEqual(
      expect.arrayContaining([expect.objectContaining({id: eligibleTarget.userId})]),
    );
    expect(ineligibleUsers.json().next_cursor).toBeNull();

    const emptyPage = await app.inject({
      method: 'GET',
      url: `/admin/auth/users/directory?search=${encodeURIComponent(`missing-${marker}`)}`,
      headers: {authorization: `Bearer ${observer.token}`},
    });
    expect(emptyPage.statusCode).toBe(200);
    expect(emptyPage.json()).toEqual({users: [], next_cursor: null});

    for (const actor of [owner, operator]) {
      const response = await app.inject({
        method: 'GET',
        url: `/admin/auth/users/directory?search=${encodeURIComponent(marker)}&limit=100`,
        headers: {authorization: `Bearer ${actor.token}`},
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().users).toHaveLength(4);
    }

    const observerActionEvents = await db()
      .select()
      .from(authOutbox)
      .where(sql`${authOutbox.payload}->>'actorId' = ${observer.userId}`);
    expect(observerActionEvents).toHaveLength(0);
  });

  test('translates directory filter errors and rejects ordinary, suspended, and impersonated sessions', async () => {
    const marker = `admin-user-directory-authz-${crypto.randomUUID()}`;
    const owner = await createVerifiedSession(`${marker}-owner`);
    const observer = await createVerifiedSession(`${marker}-observer`);
    const ordinary = await createVerifiedSession(`${marker}-ordinary`);
    const suspended = await createVerifiedSession(`${marker}-suspended`);

    const bootstrap = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'directory-authz-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    expect(bootstrap.statusCode).toBe(201);

    for (const [userId, role, idempotencyKey] of [
      [observer.userId, 'admin-observer', 'directory-authz-observer-grant'],
      [suspended.userId, 'admin-observer', 'directory-authz-suspended-grant'],
    ] as const) {
      const grant = await app.inject({
        method: 'POST',
        url: '/admin/auth/admin-grants',
        headers: authHeaders(owner.token, idempotencyKey),
        payload: {user_id: userId, role, reason: 'Directory read access'},
      });
      expect(grant.statusCode).toBe(201);
    }
    await db().update(users).set({status: 'suspended'}).where(eq(users.id, suspended.userId));

    const ordinaryResponse = await app.inject({
      method: 'GET',
      url: '/admin/auth/users/directory',
      headers: {authorization: `Bearer ${ordinary.token}`},
    });
    expect(ordinaryResponse.statusCode).toBe(403);
    expect(ordinaryResponse.json()).toEqual({
      code: 'forbidden',
      details: {required_role: 'admin-observer'},
    });

    const suspendedResponse = await app.inject({
      method: 'GET',
      url: '/admin/auth/users/directory',
      headers: {authorization: `Bearer ${suspended.token}`},
    });
    expect(suspendedResponse.statusCode).toBe(403);
    expect(suspendedResponse.json().code).toBe('forbidden');

    const impersonatedResponse = await app.inject({
      method: 'GET',
      url: '/admin/auth/users/directory',
      headers: {authorization: `Bearer ${await impersonatedToken(owner.userId, owner.email)}`},
    });
    expect(impersonatedResponse.statusCode).toBe(403);
    expect(impersonatedResponse.json()).toEqual({code: 'admin-role-required'});

    const invalidFilter = await app.inject({
      method: 'GET',
      url: '/admin/auth/users/directory?status=suspended&impersonation_eligible=true',
      headers: {authorization: `Bearer ${observer.token}`},
    });
    expect(invalidFilter.statusCode).toBe(400);
    expect(invalidFilter.json().code).toBe('validation-error');

    const invalidCursor = await app.inject({
      method: 'GET',
      url: '/admin/auth/users/directory?cursor=not-a-real-cursor',
      headers: {authorization: `Bearer ${observer.token}`},
    });
    expect(invalidCursor.statusCode).toBe(400);
    expect(invalidCursor.json().code).toBe('invalid-cursor');
  });

  test('uses independent source-IP and actor buckets for directory reads', async () => {
    const owner = await createVerifiedSession('admin-directory-rate-limit-owner');
    const observer = await createVerifiedSession('admin-directory-rate-limit-observer');

    const bootstrap = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'directory-rate-limit-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    expect(bootstrap.statusCode).toBe(201);

    const grant = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'directory-rate-limit-grant'),
      payload: {
        user_id: observer.userId,
        role: 'admin-observer',
        reason: 'Directory read access',
      },
    });
    expect(grant.statusCode).toBe(201);

    await seedExhaustedIpBucket({
      action: 'directory',
      identifier: '127.0.0.1',
      limit: 60,
      windowSeconds: 5 * 60,
    });
    const ipBlocked = await app.inject({
      method: 'GET',
      url: '/admin/auth/users/directory',
      headers: {authorization: `Bearer ${observer.token}`},
    });
    expect(ipBlocked.statusCode).toBe(429);
    expect(ipBlocked.json().code).toBe('rate-limited');

    await seedExhaustedIpBucket({
      action: 'directory',
      scope: 'actor',
      identifier: observer.userId,
      limit: 60,
      windowSeconds: 5 * 60,
    });
    const actorBlocked = await app.inject({
      method: 'GET',
      url: '/admin/auth/users/directory',
      remoteAddress: '10.0.0.2',
      headers: {authorization: `Bearer ${observer.token}`},
    });
    expect(actorBlocked.statusCode).toBe(429);
    expect(actorBlocked.json().code).toBe('rate-limited');
  });

  test('rate-limits directory requests before checking the observer role', async () => {
    const ordinary = await createVerifiedSession('admin-directory-rate-limit-ordinary');

    await seedExhaustedIpBucket({
      action: 'directory',
      identifier: '127.0.0.1',
      limit: 60,
      windowSeconds: 5 * 60,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/admin/auth/users/directory',
      headers: {authorization: `Bearer ${ordinary.token}`},
    });

    expect(response.statusCode).toBe(429);
    expect(response.json().code).toBe('rate-limited');
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
    expect(suspendedMe.statusCode).toBe(200);
    expect(suspendedMe.json().user).toMatchObject({id: target.userId, status: 'suspended'});
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

    const revokedAccess = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {authorization: `Bearer ${newLogin.json().token}`},
    });
    expect(revokedAccess.statusCode).toBe(200);

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

  function impersonateMint(params: {
    token: string;
    targetUserId: string;
    idempotencyKey: string;
    reason?: string;
  }) {
    return app.inject({
      method: 'POST',
      url: `/admin/auth/users/${params.targetUserId}/impersonate`,
      headers: authHeaders(params.token, params.idempotencyKey),
      payload: {reason: params.reason ?? 'Support reproduction'},
    });
  }

  async function bootstrapOwner(prefix: string): Promise<string> {
    const owner = await createVerifiedSession(`${prefix}-owner`);
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, `${prefix}-bootstrap`),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    expect(bootstrap.statusCode).toBe(201);
    return owner.token;
  }

  type ImpersonationEventPayload = {
    command: string;
    result: 'succeeded' | 'failed';
    idempotencyKeyFingerprint: string;
    actorId: string;
    actorRole: string;
    requiredRole: string;
    targetType: string;
    targetId: string;
    reason: string;
  };

  function impersonationEvents(): Promise<ImpersonationEventPayload[]> {
    return db()
      .select()
      .from(authOutbox)
      .orderBy(asc(authOutbox.createdAt))
      .then((rows) =>
        rows
          .filter(
            (event) =>
              event.eventType === ADMINISTRATION_ACTION_PERFORMED &&
              (event.payload as {command?: string}).command === 'auth.user.impersonate',
          )
          .map((event) => event.payload as ImpersonationEventPayload),
      );
  }

  test('mints an impersonated session with the contract shape, no cookie, and no refresh material', async () => {
    const ownerToken = await bootstrapOwner('impersonate-mint');
    const target = await createVerifiedSession('impersonate-mint-target');

    const minted = await impersonateMint({
      token: ownerToken,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-mint',
      reason: 'Support reproduction',
    });

    expect(minted.statusCode).toBe(200);
    expect(minted.headers['set-cookie']).toBeUndefined();
    const body = impersonateResponseSchema.parse(minted.json());
    expect(body.impersonator_id).not.toBe(target.userId);
    expect(body.user.id).toBe(target.userId);
    const ttlMs = Date.parse(body.expires_at) - Date.parse(body.server_time);
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(15 * 60 * 1000);

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {authorization: `Bearer ${body.token}`},
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: {id: target.userId, email: target.email},
      impersonator_id: body.impersonator_id,
    });

    // The minted token cannot be refreshed: no refresh session exists.
    const refresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: `shipfox_refresh_token=${body.token}`},
      payload: {},
    });
    expect(refresh.statusCode).toBe(401);
    const targetSessions = await db()
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, target.userId));
    // The fixture session's own refresh row is untouched: the mint creates none.
    expect(targetSessions).toHaveLength(1);
    expect(JSON.stringify(targetSessions)).not.toContain(hashOpaqueToken(body.token));

    // One success event, redacted: no token, no raw key, no reason leak beyond the reason itself.
    const events = await impersonationEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      command: 'auth.user.impersonate',
      targetType: 'user',
      targetId: target.userId,
      requiredRole: 'admin-operator',
      reason: 'Support reproduction',
      result: 'succeeded',
    });
    expect(JSON.stringify(events[0])).not.toContain(body.token);
    expect(JSON.stringify(events[0])).not.toContain('impersonate-mint');

    // The stored command result is fingerprint-only.
    const storedRows = await db()
      .select()
      .from(adminCommandResults)
      .where(eq(adminCommandResults.command, 'auth.user.impersonate'));
    expect(storedRows).toHaveLength(1);
    const stored = storedRows[0]?.result;
    if (!stored || !('impersonation' in stored)) throw new Error('Missing stored result');
    expect(stored.impersonation).toEqual({
      targetUserId: target.userId,
      expiresAt: body.expires_at,
      tokenFingerprints: [hashOpaqueToken(body.token)],
    });
    expect(JSON.stringify(storedRows[0]?.result)).not.toContain(body.token);
  });

  test('rejects the mint when AUTH_IMPERSONATION_ENABLED is false and audits the denial', async () => {
    const ownerToken = await bootstrapOwner('impersonate-disabled');
    const target = await createVerifiedSession('impersonate-disabled-target');
    setImpersonationEnabled(false);

    const response = await impersonateMint({
      token: ownerToken,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-disabled',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({code: 'impersonation-disabled'});
    const events = await impersonationEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({result: 'failed', command: 'auth.user.impersonate'});
    await expect(
      db()
        .select()
        .from(adminCommandResults)
        .where(eq(adminCommandResults.command, 'auth.user.impersonate')),
    ).resolves.toHaveLength(0);
  });

  test('rejects the mint for observers and audits the denial with the actor role', async () => {
    const ownerToken = await bootstrapOwner('impersonate-observer');
    const observer = await createVerifiedSession('impersonate-observer-actor');
    const target = await createVerifiedSession('impersonate-observer-target');
    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(ownerToken, 'impersonate-observer-grant'),
      payload: {
        user_id: observer.userId,
        role: 'admin-observer',
        reason: 'Read-only administration access',
      },
    });

    const response = await impersonateMint({
      token: observer.token,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-observer-mint',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      code: 'forbidden',
      details: {required_role: 'admin-operator'},
    });
    const events = await impersonationEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorId: observer.userId,
      actorRole: 'admin-observer',
      requiredRole: 'admin-operator',
      result: 'failed',
    });
  });

  test('rejects ineligible targets: unverified, suspended, and unknown users', async () => {
    const ownerToken = await bootstrapOwner('impersonate-ladder');
    const unverified = await createVerifiedSession('impersonate-ladder-unverified');
    await db().update(users).set({emailVerifiedAt: null}).where(eq(users.id, unverified.userId));
    const suspended = await createVerifiedSession('impersonate-ladder-suspended');
    await db().update(users).set({status: 'suspended'}).where(eq(users.id, suspended.userId));

    const unverifiedTarget = await impersonateMint({
      token: ownerToken,
      targetUserId: unverified.userId,
      idempotencyKey: 'impersonate-ladder-unverified',
    });
    expect(unverifiedTarget.statusCode).toBe(403);
    expect(unverifiedTarget.json().code).toBe('impersonation-target-not-active');

    const suspendedTarget = await impersonateMint({
      token: ownerToken,
      targetUserId: suspended.userId,
      idempotencyKey: 'impersonate-ladder-suspended',
    });
    expect(suspendedTarget.statusCode).toBe(403);
    expect(suspendedTarget.json().code).toBe('impersonation-target-not-active');

    const missingTarget = await impersonateMint({
      token: ownerToken,
      targetUserId: crypto.randomUUID(),
      idempotencyKey: 'impersonate-ladder-missing',
    });
    expect(missingTarget.statusCode).toBe(404);
    expect(missingTarget.json().code).toBe('not-found');

    // Every ladder denial by an identifiable admin role is audited with one
    // `failed` event carrying the actor, the reason, and the key fingerprint.
    const events = await impersonationEvents();
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.result)).toEqual(['failed', 'failed']);
    expect(events.every((event) => event.actorRole === 'admin-owner')).toBe(true);
    expect(events.every((event) => event.reason === 'Support reproduction')).toBe(true);
    // The unknown-target 404 is a client-contract error, not a denial: it is
    // reported to the caller and never enters the failure-event stream.
    expect(
      events.some(
        (event) =>
          event.idempotencyKeyFingerprint === hashOpaqueToken('impersonate-ladder-missing'),
      ),
    ).toBe(false);
  });

  test('rejects impersonating an administrator target even for an owner', async () => {
    const ownerToken = await bootstrapOwner('impersonate-admin-target');
    const secondOwner = await createVerifiedSession('impersonate-admin-target-second');
    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(ownerToken, 'impersonate-admin-target-grant'),
      payload: {user_id: secondOwner.userId, role: 'admin-owner', reason: 'Second owner'},
    });

    const response = await impersonateMint({
      token: ownerToken,
      targetUserId: secondOwner.userId,
      idempotencyKey: 'impersonate-admin-target-mint',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('cannot-impersonate-administrator');
    const events = await impersonationEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      result: 'failed',
      actorRole: 'admin-owner',
      reason: 'Support reproduction',
    });
  });

  test('rejects self-impersonation with cannot-impersonate-self', async () => {
    const ownerToken = await bootstrapOwner('impersonate-self');
    const owner = await createVerifiedSession('impersonate-self-actor');
    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(ownerToken, 'impersonate-self-grant'),
      payload: {user_id: owner.userId, role: 'admin-operator', reason: 'Operator'},
    });

    const response = await impersonateMint({
      token: owner.token,
      targetUserId: owner.userId,
      idempotencyKey: 'impersonate-self-mint',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('cannot-impersonate-self');
    const events = await impersonationEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      result: 'failed',
      actorRole: 'admin-operator',
      reason: 'Support reproduction',
    });
  });

  test('replays in-window with the original expiry, a fresh signature, and its own event', async () => {
    const ownerToken = await bootstrapOwner('impersonate-replay');
    const target = await createVerifiedSession('impersonate-replay-target');

    const minted = await impersonateMint({
      token: ownerToken,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-replay',
    });
    expect(minted.statusCode).toBe(200);
    const first = impersonateResponseSchema.parse(minted.json());

    const replayed = await impersonateMint({
      token: ownerToken,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-replay',
    });
    expect(replayed.statusCode).toBe(200);
    const second = impersonateResponseSchema.parse(replayed.json());
    expect(second.expires_at).toBe(first.expires_at);
    expect(second.token).not.toBe(first.token);

    // The re-signed token's `exp` never exceeds the advertised expiry: the
    // replay re-signs with the remaining lifetime to the stored `expires_at`,
    // and the initial mint advertises the token's actual signed `exp`.
    const firstClaims = await verifyUserToken({token: first.token, secret: userAccessTokenKey()});
    expect(firstClaims.exp * 1000).toBe(Date.parse(first.expires_at));
    const secondClaims = await verifyUserToken({token: second.token, secret: userAccessTokenKey()});
    expect(secondClaims.exp * 1000).toBeLessThanOrEqual(Date.parse(first.expires_at));

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {authorization: `Bearer ${second.token}`},
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(target.userId);

    // Two events under one fingerprint (the second is the replay marker) and
    // two stored fingerprints; no raw token anywhere.
    const events = await impersonationEvents();
    expect(events).toHaveLength(2);
    expect(events[0]?.idempotencyKeyFingerprint).toBe(events[1]?.idempotencyKeyFingerprint);
    expect(events.every((event) => event.result === 'succeeded')).toBe(true);
    const storedRows = await db()
      .select()
      .from(adminCommandResults)
      .where(eq(adminCommandResults.command, 'auth.user.impersonate'));
    const stored = storedRows[0]?.result;
    if (!stored || !('impersonation' in stored)) throw new Error('Missing stored result');
    expect(stored.impersonation.tokenFingerprints).toEqual([
      hashOpaqueToken(first.token),
      hashOpaqueToken(second.token),
    ]);
    expect(stored.impersonation.expiresAt).toBe(first.expires_at);
    expect(JSON.stringify(storedRows[0]?.result)).not.toContain(first.token);
    expect(JSON.stringify(storedRows[0]?.result)).not.toContain(second.token);
  });

  test('replays after expiry with impersonation-expired', async () => {
    const ownerToken = await bootstrapOwner('impersonate-expired');
    const target = await createVerifiedSession('impersonate-expired-target');

    const minted = await impersonateMint({
      token: ownerToken,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-expired',
    });
    expect(minted.statusCode).toBe(200);

    const storedRows = await db()
      .select()
      .from(adminCommandResults)
      .where(eq(adminCommandResults.command, 'auth.user.impersonate'));
    const stored = storedRows[0]?.result;
    if (!stored || !('impersonation' in stored)) throw new Error('Missing stored result');
    await db()
      .update(adminCommandResults)
      .set({
        result: {
          impersonation: {
            ...stored.impersonation,
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          },
        },
      })
      .where(eq(adminCommandResults.id, storedRows[0]?.id ?? ''));

    const replayed = await impersonateMint({
      token: ownerToken,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-expired',
    });
    expect(replayed.statusCode).toBe(410);
    expect(replayed.json().code).toBe('impersonation-expired');
    const events = await impersonationEvents();
    expect(events.at(-1)).toMatchObject({result: 'failed'});
  });

  test('a replay with a revoked operator grant fails closed and is audited', async () => {
    const ownerToken = await bootstrapOwner('impersonate-revoke');
    const operator = await createVerifiedSession('impersonate-revoke-operator');
    const target = await createVerifiedSession('impersonate-revoke-target');
    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(ownerToken, 'impersonate-revoke-grant'),
      payload: {user_id: operator.userId, role: 'admin-operator', reason: 'Operator'},
    });

    const minted = await impersonateMint({
      token: operator.token,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-revoke-mint',
    });
    expect(minted.statusCode).toBe(200);

    // Revoke the operator's grant (keep the owner's), then replay the same key.
    const grants = await app.inject({
      method: 'GET',
      url: '/admin/auth/admin-grants',
      headers: {authorization: `Bearer ${ownerToken}`},
    });
    const grantId = (grants.json().grants as Array<{grant_id: string; user: {id: string}}>).find(
      (grant) => grant.user.id === operator.userId,
    )?.grant_id;
    expect(grantId).toBeDefined();
    const revoked = await app.inject({
      method: 'DELETE',
      url: `/admin/auth/admin-grants/${grantId}`,
      headers: authHeaders(ownerToken, 'impersonate-revoke-revoke'),
      payload: {reason: 'E2E grant revocation'},
    });
    expect(revoked.statusCode).toBe(200);

    const replayed = await impersonateMint({
      token: operator.token,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-revoke-mint',
    });
    expect(replayed.statusCode).toBe(403);
    expect(replayed.json().code).toBe('forbidden');
    // The initial mint remains the only recorded event: the strict event
    // schema requires an actor role, and the actor is role-less after the
    // revocation, so the denial itself is the fail-closed record.
    const events = await impersonationEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.result).toBe('succeeded');
  });

  test('a replay with the flag turned off fails closed and is audited', async () => {
    const ownerToken = await bootstrapOwner('impersonate-flag-replay');
    const target = await createVerifiedSession('impersonate-flag-replay-target');

    const minted = await impersonateMint({
      token: ownerToken,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-flag-replay',
    });
    expect(minted.statusCode).toBe(200);

    setImpersonationEnabled(false);
    const replayed = await impersonateMint({
      token: ownerToken,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-flag-replay',
    });
    expect(replayed.statusCode).toBe(403);
    expect(replayed.json().code).toBe('impersonation-disabled');

    const events = await impersonationEvents();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      result: 'failed',
      idempotencyKeyFingerprint: events[0]?.idempotencyKeyFingerprint,
    });
  });

  test('a replay after the target is suspended mid-window fails closed and is audited', async () => {
    const ownerToken = await bootstrapOwner('impersonate-target-suspend');
    const target = await createVerifiedSession('impersonate-target-suspend-target');

    const minted = await impersonateMint({
      token: ownerToken,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-target-suspend',
    });
    expect(minted.statusCode).toBe(200);

    // Suspend the target mid-window, then replay the same key: the ladder
    // re-runs on every replay, so the suspension ends the capability.
    await db().update(users).set({status: 'suspended'}).where(eq(users.id, target.userId));

    const replayed = await impersonateMint({
      token: ownerToken,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-target-suspend',
    });
    expect(replayed.statusCode).toBe(403);
    expect(replayed.json().code).toBe('impersonation-target-not-active');

    const events = await impersonationEvents();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      result: 'failed',
      actorRole: 'admin-owner',
      idempotencyKeyFingerprint: events[0]?.idempotencyKeyFingerprint,
    });
  });

  test('a replay after the target gains an administrator grant mid-window fails closed and is audited', async () => {
    const ownerToken = await bootstrapOwner('impersonate-target-grant');
    const target = await createVerifiedSession('impersonate-target-grant-target');

    const minted = await impersonateMint({
      token: ownerToken,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-target-grant',
    });
    expect(minted.statusCode).toBe(200);

    // Promote the target mid-window: the anti-escalation rule (no active
    // administrator grant on the target) must hold on the replay path too.
    await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(ownerToken, 'impersonate-target-grant-grant'),
      payload: {user_id: target.userId, role: 'admin-operator', reason: 'Mid-window promotion'},
    });

    const replayed = await impersonateMint({
      token: ownerToken,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-target-grant',
    });
    expect(replayed.statusCode).toBe(403);
    expect(replayed.json().code).toBe('cannot-impersonate-administrator');

    const events = await impersonationEvents();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      result: 'failed',
      actorRole: 'admin-owner',
      idempotencyKeyFingerprint: events[0]?.idempotencyKeyFingerprint,
    });
  });

  test('mints with AUTH_JWT_EXPIRES_IN below the 15-minute cap', async () => {
    const ownerToken = await bootstrapOwner('impersonate-below-cap');
    const target = await createVerifiedSession('impersonate-below-cap-target');
    setAuthJwtExpiresIn('5m');

    const minted = await impersonateMint({
      token: ownerToken,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-below-cap',
    });
    expect(minted.statusCode).toBe(200);
    const body = impersonateResponseSchema.parse(minted.json());
    const ttlSeconds = (Date.parse(body.expires_at) - Date.parse(body.server_time)) / 1000;
    expect(ttlSeconds).toBeGreaterThan(290);
    expect(ttlSeconds).toBeLessThanOrEqual(300);
    // The signed token carries the same whole-second expiry as the response.
    const claims = await verifyUserToken({token: body.token, secret: userAccessTokenKey()});
    expect(claims.exp - claims.iat).toBe(300);
    expect(new Date(claims.exp * 1000).toISOString()).toBe(body.expires_at);
  });

  test('rejects idempotency-key reuse across different targets', async () => {
    const ownerToken = await bootstrapOwner('impersonate-key-reuse');
    const first = await createVerifiedSession('impersonate-key-reuse-first');
    const second = await createVerifiedSession('impersonate-key-reuse-second');

    const minted = await impersonateMint({
      token: ownerToken,
      targetUserId: first.userId,
      idempotencyKey: 'impersonate-key-reuse',
    });
    expect(minted.statusCode).toBe(200);

    const reused = await impersonateMint({
      token: ownerToken,
      targetUserId: second.userId,
      idempotencyKey: 'impersonate-key-reuse',
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().code).toBe('idempotency-key-reused');
    // The 409 is a client-contract error: no denial event is published under
    // the same fingerprint, so replay markers stay unambiguous.
    const events = await impersonationEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.result).toBe('succeeded');
  });

  test('rate-limits impersonation mints by source IP', async () => {
    const ownerToken = await bootstrapOwner('impersonate-rate-limit');
    const target = await createVerifiedSession('impersonate-rate-limit-target');

    await seedExhaustedIpBucket({
      action: 'impersonate',
      identifier: '127.0.0.1',
      limit: 20,
      windowSeconds: 15 * 60,
    });
    const blocked = await impersonateMint({
      token: ownerToken,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-rate-limit',
    });
    expect(blocked.statusCode).toBe(429);
  });

  test('rate-limits impersonation mints per actor', async () => {
    const owner = await createVerifiedSession('impersonate-actor-limit-owner');
    const bootstrap = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'impersonate-actor-limit-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    expect(bootstrap.statusCode).toBe(201);
    const target = await createVerifiedSession('impersonate-actor-limit-target');

    await seedExhaustedIpBucket({
      action: 'impersonate',
      scope: 'actor',
      identifier: owner.userId,
      limit: 20,
      windowSeconds: 15 * 60,
    });
    const blocked = await impersonateMint({
      token: owner.token,
      targetUserId: target.userId,
      idempotencyKey: 'impersonate-actor-limit',
    });
    expect(blocked.statusCode).toBe(429);
  });

  test('rate-limits an impersonated-session probe on the mint route before the guard rejects it', async () => {
    const owner = await createVerifiedSession('impersonate-probe-owner');
    const target = await createVerifiedSession('impersonate-probe-target');
    const markedToken = await impersonatedToken(owner.userId, owner.email);

    // The limiter runs ahead of the administration guard, so a marked-session
    // probe consumes the `impersonate` buckets and is throttled (429) instead
    // of being rejected by the guard first and bypassing the limiter (403).
    await seedExhaustedIpBucket({
      action: 'impersonate',
      identifier: '127.0.0.1',
      limit: 20,
      windowSeconds: 15 * 60,
    });
    const ipBlocked = await app.inject({
      method: 'POST',
      url: `/admin/auth/users/${target.userId}/impersonate`,
      headers: authHeaders(markedToken, 'impersonate-probe-mint'),
      payload: {reason: 'Nested impersonation attempt'},
    });
    expect(ipBlocked.statusCode).toBe(429);

    // The per-actor bucket is consumed the same way: the marked token's
    // subject is the actor keying the bucket. The limiter enforces IP before
    // actor, and the first half exhausted the 127.0.0.1 IP bucket, so the
    // probe must come from a fresh source IP for the 429 to be attributable
    // to the seeded actor bucket alone.
    await seedExhaustedIpBucket({
      action: 'impersonate',
      scope: 'actor',
      identifier: owner.userId,
      limit: 20,
      windowSeconds: 15 * 60,
    });
    const actorBlocked = await app.inject({
      method: 'POST',
      url: `/admin/auth/users/${target.userId}/impersonate`,
      headers: authHeaders(markedToken, 'impersonate-probe-mint'),
      remoteAddress: '10.0.0.1',
      payload: {reason: 'Nested impersonation attempt'},
    });
    expect(actorBlocked.statusCode).toBe(429);
  });

  test('rejects an impersonated actor on the mint route before any side effect', async () => {
    const owner = await createVerifiedSession('impersonate-actor');
    const target = await createVerifiedSession('impersonate-actor-target');

    const response = await app.inject({
      method: 'POST',
      url: `/admin/auth/users/${target.userId}/impersonate`,
      headers: authHeaders(
        await impersonatedToken(owner.userId, owner.email),
        'impersonate-actor-mint',
      ),
      payload: {reason: 'Nested impersonation attempt'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({code: 'admin-role-required'});
    await expect(db().select().from(adminCommandResults)).resolves.toHaveLength(0);
    await expect(db().select().from(authOutbox)).resolves.toHaveLength(0);
  });

  test('requires a bounded reason on the mint route', async () => {
    const ownerToken = await bootstrapOwner('impersonate-reason');
    const target = await createVerifiedSession('impersonate-reason-target');

    const withoutReason = await app.inject({
      method: 'POST',
      url: `/admin/auth/users/${target.userId}/impersonate`,
      headers: authHeaders(ownerToken, 'impersonate-reason-missing'),
      payload: {},
    });
    expect(withoutReason.statusCode).toBe(400);

    const withControlCharacter = await app.inject({
      method: 'POST',
      url: `/admin/auth/users/${target.userId}/impersonate`,
      headers: authHeaders(ownerToken, 'impersonate-reason-control'),
      payload: {reason: 'Support\u0000reproduction'},
    });
    expect(withControlCharacter.statusCode).toBe(400);
  });
});
