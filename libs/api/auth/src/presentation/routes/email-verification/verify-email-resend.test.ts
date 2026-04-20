import type {FastifyInstance} from 'fastify';
import {
  capturedMail,
  createAuthTestApp,
  resetCapturedMail,
  signup,
  uniqueEmail,
  verifyEmail,
} from '#test/routes.js';

describe('POST /auth/verify-email/resend', () => {
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

  test('returns 204 and sends a new token for an unverified account', async () => {
    const email = uniqueEmail('verify-resend');
    await signup(app, {email, password: 'correct horse battery staple'});

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/resend',
      payload: {email: email.toUpperCase()},
    });

    expect(res.statusCode).toBe(204);
    expect(capturedMail().filter((message) => message.to === email)).toHaveLength(2);
  });

  test('returns 204 without sending mail for a verified account', async () => {
    const email = uniqueEmail('verify-resend-verified');
    await signup(app, {email, password: 'correct horse battery staple'});
    await verifyEmail(app, email);
    resetCapturedMail();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/resend',
      payload: {email},
    });

    expect(res.statusCode).toBe(204);
    expect(capturedMail()).toHaveLength(0);
  });
});
