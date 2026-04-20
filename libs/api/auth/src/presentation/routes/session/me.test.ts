import type {FastifyInstance} from 'fastify';
import {signUserToken} from '#core/jwt.js';
import {
  createAuthTestApp,
  ROUTE_TEST_SECRET,
  resetCapturedMail,
  signupVerifyLogin,
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
    const account = await signupVerifyLogin(app, 'me');

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {authorization: `Bearer ${account.token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(account.email);
  });

  test('transforms a token for a missing user into 404', async () => {
    const token = await signUserToken({
      userId: crypto.randomUUID(),
      email: 'missing@example.com',
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
