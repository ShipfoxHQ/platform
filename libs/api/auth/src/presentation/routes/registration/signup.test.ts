import type {FastifyInstance} from 'fastify';
import {
  createAuthTestApp,
  latestMailTo,
  resetCapturedMail,
  signup,
  uniqueEmail,
} from '#test/routes.js';

describe('POST /auth/signup', () => {
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

  test('returns 201 with a pending user and sends verification mail', async () => {
    const email = uniqueEmail('signup');

    const res = await signup(app, {
      email: email.toUpperCase(),
      password: 'correct horse battery staple',
      name: 'New User',
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().user.email).toBe(email);
    expect(res.json().user.email_verified_at).toBeNull();
    expect(latestMailTo(email).subject).toBe('Verify your email');
  });

  test('transforms duplicate email into 409', async () => {
    const email = uniqueEmail('duplicate');
    await signup(app, {email, password: 'correct horse battery staple'});

    const res = await signup(app, {email, password: 'correct horse battery staple'});

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('email-taken');
  });
});
