import type {FastifyInstance} from 'fastify';
import {
  cookieHeader,
  createAuthTestApp,
  resetCapturedMail,
  signupVerifyLogin,
} from '#test/routes.js';

describe('POST /auth/refresh', () => {
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

  test('returns a fresh access token and rotates the refresh cookie', async () => {
    const account = await signupVerifyLogin(app, 'refresh');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: cookieHeader(account.refreshCookie)},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeDefined();
    expect(res.json().user.email).toBe(account.email);
    expect(res.headers['set-cookie']).toContain('shipfox_refresh_token=');
    expect(res.headers['set-cookie']).toContain('HttpOnly');
    expect(res.headers['set-cookie']).toContain('Secure');
    expect(res.headers['set-cookie']).toContain('SameSite=Lax');
    expect(res.headers['set-cookie']).toContain('Path=/auth');
  });

  test('transforms missing refresh cookie into 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
    expect(res.headers['set-cookie']).toContain('shipfox_refresh_token=;');
  });

  test('transforms stale refresh token into 401', async () => {
    const account = await signupVerifyLogin(app, 'refresh-stale');
    await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: cookieHeader(account.refreshCookie)},
    });

    const stale = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: cookieHeader(account.refreshCookie)},
    });

    expect(stale.statusCode).toBe(401);
    expect(stale.json().code).toBe('unauthorized');
  });
});
