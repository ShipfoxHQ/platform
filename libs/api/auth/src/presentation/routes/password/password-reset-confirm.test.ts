import type {FastifyInstance} from 'fastify';
import {
  createAuthTestApp,
  extractToken,
  getSetCookie,
  latestMailTo,
  login,
  resetCapturedMail,
  signupVerifyLogin,
} from '#test/routes.js';

describe('POST /auth/password-reset/confirm', () => {
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

  test('updates credentials with a reset token', async () => {
    const account = await signupVerifyLogin(app, 'reset-confirm');
    await app.inject({
      method: 'POST',
      url: '/auth/password-reset',
      payload: {email: account.email},
    });
    const resetToken = extractToken(latestMailTo(account.email).text ?? '');

    const confirm = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: {token: resetToken, new_password: 'reset password is long'},
    });
    const loginRes = await login(app, {email: account.email, password: 'reset password is long'});

    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().token).toBeDefined();
    expect(confirm.json().user.email).toBe(account.email);
    expect(getSetCookie(confirm)).toContain('shipfox_refresh_token=');
    expect(loginRes.statusCode).toBe(200);
  });

  test('transforms invalid token into 410', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: {token: 'bad-token', new_password: 'reset password is long'},
    });

    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe('token-invalid');
  });
});
