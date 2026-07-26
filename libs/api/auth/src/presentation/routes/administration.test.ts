import {ADMINISTRATION_ACTION_PERFORMED} from '@shipfox/api-common-dto';
import {sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {db} from '#db/db.js';
import {authOutbox} from '#db/schema/outbox.js';
import {createAuthTestApp, createVerifiedSession, resetCapturedMail} from '#test/routes.js';

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
      url: '/admin/v1/auth/admin-grants/bootstrap',
      headers: {'idempotency-key': 'anonymous-bootstrap'},
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });

    expect(response.statusCode).toBe(401);
  });

  test('rejects an invalid bootstrap token without writing a grant or event', async () => {
    const account = await createVerifiedSession('admin-bootstrap-invalid');

    const response = await app.inject({
      method: 'POST',
      url: '/admin/v1/auth/admin-grants/bootstrap',
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
        url: '/admin/v1/auth/admin-grants/bootstrap',
        headers: authHeaders(account.token, `bootstrap-rate-limit-${attempt}`),
        payload: {bootstrap_token: 'wrong-token'},
      });
      expect(response.statusCode).toBe(403);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/admin/v1/auth/admin-grants/bootstrap',
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
      url: '/admin/v1/auth/admin-grants/bootstrap',
      headers: authHeaders(first.token, 'bootstrap-first'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({user_id: first.userId, role: 'admin-owner'});

    const repeated = await app.inject({
      method: 'POST',
      url: '/admin/v1/auth/admin-grants/bootstrap',
      headers: authHeaders(first.token, 'bootstrap-first'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    expect(repeated.statusCode).toBe(201);
    expect(repeated.json().id).toBe(response.json().id);

    const secondAttempt = await app.inject({
      method: 'POST',
      url: '/admin/v1/auth/admin-grants/bootstrap',
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

  test('lets an owner list, grant, and revoke roles with idempotent audited mutations', async () => {
    const owner = await createVerifiedSession('admin-grant-owner');
    const target = await createVerifiedSession('admin-grant-target');

    const bootstrap = await app.inject({
      method: 'POST',
      url: '/admin/v1/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'grant-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    expect(bootstrap.statusCode).toBe(201);

    const grant = await app.inject({
      method: 'POST',
      url: '/admin/v1/auth/admin-grants',
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
      url: '/admin/v1/auth/admin-grants',
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
      url: '/admin/v1/auth/admin-grants',
      headers: {authorization: `Bearer ${owner.token}`},
    });
    expect(grants.statusCode).toBe(200);
    expect(grants.json().grants).toEqual(
      expect.arrayContaining([expect.objectContaining({user_id: target.userId})]),
    );

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/admin/v1/auth/admin-grants/${grant.json().id}`,
      headers: authHeaders(owner.token, 'revoke-observer'),
      payload: {reason: 'Support investigation complete'},
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({id: grant.json().id, revoked_at: expect.any(String)});

    const repeatedRevoke = await app.inject({
      method: 'DELETE',
      url: `/admin/v1/auth/admin-grants/${grant.json().id}`,
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

  test('protects the final active owner and rejects idempotency-key reuse', async () => {
    const owner = await createVerifiedSession('admin-final-owner');
    const target = await createVerifiedSession('admin-final-target');

    await app.inject({
      method: 'POST',
      url: '/admin/v1/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, 'final-bootstrap'),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });

    const firstGrant = await app.inject({
      method: 'POST',
      url: '/admin/v1/auth/admin-grants',
      headers: authHeaders(owner.token, 'role-key'),
      payload: {user_id: target.userId, role: 'admin-observer', reason: 'Initial review'},
    });
    expect(firstGrant.statusCode).toBe(201);

    const reusedKey = await app.inject({
      method: 'POST',
      url: '/admin/v1/auth/admin-grants',
      headers: authHeaders(owner.token, 'role-key'),
      payload: {user_id: target.userId, role: 'admin-operator', reason: 'Different command'},
    });
    expect(reusedKey.statusCode).toBe(409);
    expect(reusedKey.json().code).toBe('idempotency-key-reused');

    const finalOwnerRevoke = await app.inject({
      method: 'DELETE',
      url: `/admin/v1/auth/admin-grants/${
        (
          await app.inject({
            method: 'GET',
            url: '/admin/v1/auth/admin-grants',
            headers: {authorization: `Bearer ${owner.token}`},
          })
        )
          .json()
          .grants.find((grant: {user_id: string}) => grant.user_id === owner.userId).id
      }`,
      headers: authHeaders(owner.token, 'revoke-final-owner'),
      payload: {reason: 'Attempt to remove final owner'},
    });
    expect(finalOwnerRevoke.statusCode).toBe(409);
    expect(finalOwnerRevoke.json().code).toBe('last-owner');
  });
});
