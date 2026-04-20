import type {FastifyInstance} from 'fastify';
import {
  createAuthTestApp,
  login,
  resetCapturedMail,
  signup,
  uniqueEmail,
  verifyEmail,
} from '#test/routes.js';

describe('POST /auth/login', () => {
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

  test('returns 200 with a token and user after verification', async () => {
    const email = uniqueEmail('login');
    const password = 'correct horse battery staple';
    await signup(app, {email, password});
    await verifyEmail(app, email);

    const res = await login(app, {email: email.toUpperCase(), password});

    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeDefined();
    expect(res.json().user.email).toBe(email);
    expect(res.headers['set-cookie']).toContain('shipfox_refresh_token=');
    expect(res.headers['set-cookie']).toContain('HttpOnly');
    expect(res.headers['set-cookie']).toContain('Secure');
    expect(res.headers['set-cookie']).toContain('SameSite=Lax');
    expect(res.headers['set-cookie']).toContain('Path=/auth');
  });

  test('transforms invalid credentials into 401', async () => {
    const email = uniqueEmail('bad-login');

    const res = await login(app, {email, password: 'wrong password'});

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('invalid-credentials');
  });

  test('transforms unverified email into 403', async () => {
    const email = uniqueEmail('unverified-login');
    const password = 'correct horse battery staple';
    await signup(app, {email, password});

    const res = await login(app, {email, password});

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('email-not-verified');
  });
});
