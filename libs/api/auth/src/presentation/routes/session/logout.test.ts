import type {FastifyInstance} from 'fastify';
import {
  cookieHeader,
  createAuthTestApp,
  resetCapturedMail,
  signupVerifyLogin,
} from '#test/routes.js';

describe('POST /auth/logout', () => {
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

  test('returns 204 and revokes the current refresh session', async () => {
    const account = await signupVerifyLogin(app, 'logout');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {cookie: cookieHeader(account.refreshCookie)},
      payload: {},
    });
    const refresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: cookieHeader(account.refreshCookie)},
      payload: {},
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['set-cookie']).toContain('shipfox_refresh_token=;');
    expect(refresh.statusCode).toBe(401);
  });

  test('returns 204 when the refresh cookie is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: {},
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['set-cookie']).toContain('shipfox_refresh_token=;');
  });
});
