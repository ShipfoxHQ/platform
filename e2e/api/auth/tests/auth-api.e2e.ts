import {meResponseSchema} from '@shipfox/api-auth-dto';
import {config} from '@shipfox/e2e-core';
import {expect, test} from './test.js';

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
