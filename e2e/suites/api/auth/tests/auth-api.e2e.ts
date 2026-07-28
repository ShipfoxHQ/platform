import {randomUUID} from 'node:crypto';
import {meResponseSchema} from '@shipfox/api-auth-dto';
import {config} from '@shipfox/e2e-core';
import {expect, test} from './test.js';

const SIGNUP_NOT_ALLOWED_MESSAGE =
  process.env.AUTH_SIGNUP_NOT_ALLOWED_MESSAGE ??
  'This E2E deployment does not accept new accounts.';

test('creates an E2E user, session, and reads the authenticated user', async ({request, auth}) => {
  const user = await auth.createUser();
  const session = await auth.createSession({user_id: user.user.id});

  const me = await request.get(`${config.API_URL}/auth/me`, {
    headers: {authorization: `Bearer ${session.token}`},
  });
  const body = meResponseSchema.parse(await me.json());

  expect(me.status()).toBe(200);
  expect(body.user.id).toBe(user.user.id);
  expect(body.user.email).toBe(user.email);
  expect(session.setCookie).toContain('shipfox_refresh_token=');
});

test('rejects a password signup outside the configured allowlist', async ({request}) => {
  const response = await request.post(`${config.API_URL}/auth/signup`, {
    data: {
      email: `blocked-${randomUUID()}@example.test`,
      password: 'correct horse battery staple',
      name: 'Blocked Signup',
    },
  });
  const body = await response.json();

  expect(response.status()).toBe(403);
  expect(body).toMatchObject({
    code: 'signup-not-allowed',
    details: {message: SIGNUP_NOT_ALLOWED_MESSAGE},
  });
});
