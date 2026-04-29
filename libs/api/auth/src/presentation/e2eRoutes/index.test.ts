import {createApp} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import {authE2eRoutes} from './index.js';

describe('auth E2E routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({
      routes: [authE2eRoutes],
      swagger: false,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  test('creates a verified user from explicit credentials', async () => {
    const password = 'correct horse battery staple';
    const res = await app.inject({
      method: 'POST',
      url: '/auth/users',
      payload: {email: `user-${crypto.randomUUID()}@example.test`, password, verified: true},
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().email).toBe(res.json().user.email);
    expect(res.json().password).toBe(password);
    expect(res.json().user.email_verified_at).not.toBeNull();
  });

  test('rejects missing credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/users',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  test('transforms duplicate email into 409', async () => {
    const email = `duplicate-${crypto.randomUUID()}@example.test`;
    await app.inject({
      method: 'POST',
      url: '/auth/users',
      payload: {email, password: 'correct horse battery staple', verified: true},
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/users',
      payload: {email, password: 'correct horse battery staple', verified: true},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('email-taken');
  });

  test('creates a browser session for an E2E-created user', async () => {
    const userRes = await app.inject({
      method: 'POST',
      url: '/auth/users',
      payload: {
        email: `session-${crypto.randomUUID()}@example.test`,
        password: 'correct horse battery staple',
        verified: true,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/sessions',
      payload: {user_id: userRes.json().user.id},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(userRes.json().user.id);
    expect(res.json().token).toBeDefined();
    expect(res.headers['set-cookie']).toContain('shipfox_refresh_token=');
  });

  test('creates an unverified user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/users',
      payload: {
        email: `unverified-${crypto.randomUUID()}@example.test`,
        password: 'correct horse battery staple',
        verified: false,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().user.email_verified_at).toBeNull();
  });
});
