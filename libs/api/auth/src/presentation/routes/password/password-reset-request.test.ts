import type {FastifyInstance} from 'fastify';
import {
  createAuthTestApp,
  latestMailTo,
  resetCapturedMail,
  signupVerifyLogin,
} from '#test/routes.js';

describe('POST /auth/password-reset', () => {
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

  test('returns 204 and sends reset mail for an active account', async () => {
    const account = await signupVerifyLogin(app, 'reset-request');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset',
      payload: {email: account.email.toUpperCase()},
    });

    expect(res.statusCode).toBe(204);
    expect(latestMailTo(account.email).subject).toBe('Reset your password');
  });

  test('returns 204 without revealing missing accounts', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset',
      payload: {email: 'missing@example.com'},
    });

    expect(res.statusCode).toBe(204);
  });
});
