import type {FastifyInstance} from 'fastify';
import {
  cookieHeader,
  createAuthTestApp,
  extractToken,
  getSetCookie,
  latestMailTo,
  resetCapturedMail,
  signup,
  uniqueEmail,
} from '#test/routes.js';

describe('POST /auth/verify-email/confirm', () => {
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

  test('verifies a user email with a valid token and starts a session', async () => {
    const email = uniqueEmail('verify-confirm');
    const password = 'correct horse battery staple';
    await signup(app, {email, password});
    const token = extractToken(latestMailTo(email).text ?? '');

    const confirm = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/confirm',
      payload: {token},
    });
    const refreshCookie = getSetCookie(confirm);
    const refresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: cookieHeader(refreshCookie)},
    });

    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().token).toEqual(expect.any(String));
    expect(confirm.json().user.email).toBe(email);
    expect(refreshCookie).toContain('shipfox_refresh_token=');
    expect(refresh.statusCode).toBe(200);
  });

  test('transforms invalid token into 410', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/confirm',
      payload: {token: 'bad-token'},
    });

    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe('token-invalid');
  });
});
