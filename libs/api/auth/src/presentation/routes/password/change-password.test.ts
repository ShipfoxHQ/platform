import type {FastifyInstance} from 'fastify';
import {signUserToken} from '#core/jwt.js';
import {
  cookieHeader,
  createAuthTestApp,
  login,
  ROUTE_TEST_SECRET,
  resetCapturedMail,
  signupVerifyLogin,
} from '#test/routes.js';

describe('POST /auth/change-password', () => {
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

  test('updates credentials and rejects the old password', async () => {
    const account = await signupVerifyLogin(app, 'change-password');

    const change = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: {
        authorization: `Bearer ${account.token}`,
        cookie: cookieHeader(account.refreshCookie),
      },
      payload: {
        current_password: account.password,
        new_password: 'new password is long',
      },
    });
    const oldLogin = await login(app, {email: account.email, password: account.password});
    const newLogin = await login(app, {email: account.email, password: 'new password is long'});
    const refresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: cookieHeader(account.refreshCookie)},
      payload: {},
    });

    expect(change.statusCode).toBe(204);
    expect(oldLogin.statusCode).toBe(401);
    expect(newLogin.statusCode).toBe(200);
    expect(refresh.statusCode).toBe(200);
  });

  test('transforms invalid current password into 401', async () => {
    const account = await signupVerifyLogin(app, 'change-password-bad');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: {authorization: `Bearer ${account.token}`},
      payload: {
        current_password: 'not the current password',
        new_password: 'new password is long',
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('invalid-credentials');
  });

  test('transforms a token for a missing user into 404', async () => {
    const token = await signUserToken({
      userId: crypto.randomUUID(),
      email: 'missing@example.com',
      secret: ROUTE_TEST_SECRET,
      expiresIn: '15m',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: {authorization: `Bearer ${token}`},
      payload: {
        current_password: 'old password',
        new_password: 'new password is long',
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });
});
