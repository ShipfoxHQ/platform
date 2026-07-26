import type {FastifyInstance} from 'fastify';
import {signUserToken} from '#core/jwt.js';
import {createAdminGrant} from '#db/admin-grants.js';
import {
  createAuthTestApp,
  createVerifiedSession,
  ROUTE_TEST_SECRET,
  resetCapturedMail,
} from '#test/routes.js';

describe('GET /auth/me', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createAuthTestApp();
  });

  beforeEach(() => {
    resetCapturedMail();
  });

  afterAll(async () => {
    await app.close();
  });

  test('returns the signed-in user', async () => {
    const account = await createVerifiedSession('me');

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {authorization: `Bearer ${account.token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(account.email);
    expect(res.json().admin_role).toBeNull();
  });

  test('returns the current Auth-owned role for dashboard presentation', async () => {
    const account = await createVerifiedSession('me-admin');
    await createAdminGrant({userId: account.userId, role: 'admin-observer'});

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {authorization: `Bearer ${account.token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().admin_role).toBe('admin-observer');
  });

  test('transforms a token for a missing user into 404', async () => {
    const token = await signUserToken({
      userId: crypto.randomUUID(),
      email: 'missing@example.com',
      memberships: [],
      secret: ROUTE_TEST_SECRET,
      expiresIn: '15m',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });
});
