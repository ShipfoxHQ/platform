import {randomUUID} from 'node:crypto';
import {impersonateResponseSchema, meResponseSchema} from '@shipfox/api-auth-dto';
import {config} from '@shipfox/e2e-core';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {expect, test} from './test.js';

const SIGNUP_NOT_ALLOWED_MESSAGE =
  process.env.AUTH_SIGNUP_NOT_ALLOWED_MESSAGE ??
  'This E2E deployment does not accept new accounts.';

const ADMIN_BOOTSTRAP_TOKEN = process.env.ADMIN_BOOTSTRAP_TOKEN;
if (!ADMIN_BOOTSTRAP_TOKEN) {
  throw new Error(
    'ADMIN_BOOTSTRAP_TOKEN is required: the E2E harness injects a per-run random ' +
      'token so the admin bootstrap step cannot be claimed with a well-known value.',
  );
}

function refreshCookieValue(setCookie: string): string {
  const cookie = setCookie.split(';')[0];
  if (!cookie) throw new Error('Set-Cookie header did not include a cookie');
  const separator = cookie.indexOf('=');
  if (separator === -1) throw new Error('Set-Cookie header did not include a cookie value');
  return cookie.slice(separator + 1);
}

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

test(
  'impersonation: a minted token acts as the target on user routes, is rejected on every admin ' +
    'and deny-listed route, cannot refresh, and a replay re-runs the authorization ladder',
  async ({request, auth}) => {
    // Operator: the bootstrapped first owner (admin-owner >= admin-operator).
    const operator = await auth.createUser();
    const operatorSession = await auth.createSession({user_id: operator.user.id});
    const operatorRefreshToken = refreshCookieValue(operatorSession.setCookie);
    let body: ReturnType<typeof impersonateResponseSchema.parse>;
    let headers: {authorization: string};
    let workspace: Awaited<ReturnType<typeof createWorkspace>>;
    let target: Awaited<ReturnType<typeof auth.createUser>>;

    await test.step('mints an access-token-only impersonated session', async () => {
      const bootstrap = await request.post(`${config.API_URL}/admin/auth/admin-grants/bootstrap`, {
        headers: {
          authorization: `Bearer ${operatorSession.token}`,
          'idempotency-key': 'e2e-impersonation-bootstrap',
        },
        data: {bootstrap_token: ADMIN_BOOTSTRAP_TOKEN},
      });
      expect(bootstrap.status()).toBe(201);

      target = await auth.createUser();
      await auth.createSession({user_id: target.user.id});
      workspace = await createWorkspace({
        userId: target.user.id,
        userEmail: target.user.email,
      });

      const mint = await request.post(
        `${config.API_URL}/admin/auth/users/${target.user.id}/impersonate`,
        {
          headers: {
            authorization: `Bearer ${operatorSession.token}`,
            'idempotency-key': 'e2e-impersonation-mint',
          },
          data: {reason: 'E2E support reproduction'},
        },
      );
      expect(mint.status()).toBe(200);
      // The mint never sets a refresh cookie: the session is access-token-only.
      expect(mint.headers()['set-cookie']).toBeUndefined();
      body = impersonateResponseSchema.parse(await mint.json());
      expect(body.impersonator_id).toBe(operator.user.id);
      expect(body.user.id).toBe(target.user.id);
      const ttlMs = Date.parse(body.expires_at) - Date.parse(body.server_time);
      expect(ttlMs).toBeGreaterThan(0);
      expect(ttlMs).toBeLessThanOrEqual(15 * 60 * 1000);
      headers = {authorization: `Bearer ${body.token}`};
    });

    await test.step('acts as the target on ordinary user routes', async () => {
      // Ordinary user routes: the impersonated token is the target's session.
      const me = await request.get(`${config.API_URL}/auth/me`, {headers});
      expect(me.status()).toBe(200);
      const meBody = meResponseSchema.parse(await me.json());
      expect(meBody.user.id).toBe(target.user.id);
      expect(meBody.impersonator_id).toBe(operator.user.id);

      // A membership-gated route proves the token carries the target's real
      // membership claims: `requireWorkspaceAccess` reads them from the signed
      // token, so a token signed with empty or foreign memberships would be
      // rejected here even though `/auth/me` only reads the `sub` claim.
      const members = await request.get(`${config.API_URL}/workspaces/${workspace.id}/members`, {
        headers,
      });
      expect(members.status()).toBe(200);
      const membersBody = (await members.json()) as {members: Array<{user: {id: string}}>};
      expect(membersBody.members.some((member) => member.user.id === target.user.id)).toBe(true);
    });

    await test.step('rejects the marked session on every /admin route', async () => {
      const adminRoutes = [
        '/admin/auth/bootstrap-state',
        '/admin/auth/admin-grants',
        `/admin/auth/users?user_id=${body.user.id}`,
        '/admin/projects',
        '/admin/workspaces',
        '/admin/runners/provisioner-tokens',
        '/admin/runners/instances',
      ];
      for (const route of adminRoutes) {
        const response = await request.get(`${config.API_URL}${route}`, {headers});
        expect(response.status(), route).toBe(403);
        expect(await response.json(), route).toEqual({code: 'admin-role-required'});
      }
    });

    await test.step('rejects the marked session on every deny-listed route', async () => {
      const denyListedRoutes = [
        {
          path: `/workspaces/${workspace.id}/runners/manual-registration-tokens`,
          data: {name: 'e2e-denied'},
        },
        {
          path: `/workspaces/${workspace.id}/provisioners/tokens`,
          data: {name: 'e2e-denied'},
        },
        {
          path: `/workspaces/${workspace.id}/invitations`,
          data: {email: `invite-${randomUUID()}@example.test`},
        },
        {path: '/invitations/accept', data: {token: 'e2e-invalid-invitation-token'}},
      ];
      for (const {path, data} of denyListedRoutes) {
        const response = await request.post(`${config.API_URL}${path}`, {headers, data});
        expect(response.status(), path).toBe(403);
        expect(await response.json(), path).toEqual({code: 'impersonation-not-permitted'});
      }
    });

    await test.step('never yields an impersonated session from the operator refresh', async () => {
      // The impersonated session has no refresh material behind it (the mint
      // set no refresh cookie, asserted above). Refreshing the operator's own
      // session restores only the operator, never the impersonated target.
      const refresh = await request.post(`${config.API_URL}/auth/refresh`, {
        headers: {cookie: `shipfox_refresh_token=${operatorRefreshToken}`},
        data: {},
      });
      expect(refresh.status()).toBe(200);
      const refreshedToken = (await refresh.json()).token;
      const me = await request.get(`${config.API_URL}/auth/me`, {
        headers: {authorization: `Bearer ${refreshedToken}`},
      });
      const meBody = meResponseSchema.parse(await me.json());
      expect(meBody.user.id).toBe(operator.user.id);
      expect(meBody.impersonator_id).toBeUndefined();
    });

    await test.step('an in-window replay re-signs with the original expiry', async () => {
      const replay = await request.post(
        `${config.API_URL}/admin/auth/users/${body.user.id}/impersonate`,
        {
          headers: {
            authorization: `Bearer ${operatorSession.token}`,
            'idempotency-key': 'e2e-impersonation-mint',
          },
          data: {reason: 'E2E support reproduction'},
        },
      );
      expect(replay.status()).toBe(200);
      const replayBody = impersonateResponseSchema.parse(await replay.json());
      expect(replayBody.expires_at).toBe(body.expires_at);
      expect(replayBody.token).not.toBe(body.token);
    });

    await test.step('a replay after the operator grant is revoked fails closed', async () => {
      // Replay with a revoked operator grant fails closed: the ladder re-runs,
      // so a revocation mid-window ends the capability (ADR 0014 deviation).
      const secondOwner = await auth.createUser();
      await auth.createSession({user_id: secondOwner.user.id});
      const grantSecondOwner = await request.post(`${config.API_URL}/admin/auth/admin-grants`, {
        headers: {
          authorization: `Bearer ${operatorSession.token}`,
          'idempotency-key': 'e2e-impersonation-second-owner',
        },
        data: {user_id: secondOwner.user.id, role: 'admin-owner', reason: 'E2E second owner'},
      });
      expect(grantSecondOwner.status()).toBe(201);

      const grants = await request.get(`${config.API_URL}/admin/auth/admin-grants`, {
        headers: {authorization: `Bearer ${operatorSession.token}`},
      });
      const grantId = (await grants.json()).grants.find(
        (grant: {user: {id: string}}) => grant.user.id === operator.user.id,
      )?.grant_id;
      expect(grantId).toBeDefined();
      const revoke = await request.delete(`${config.API_URL}/admin/auth/admin-grants/${grantId}`, {
        headers: {
          authorization: `Bearer ${operatorSession.token}`,
          'idempotency-key': 'e2e-impersonation-revoke',
        },
        data: {reason: 'E2E grant revocation'},
      });
      expect(revoke.status()).toBe(200);

      const replayAfterRevoke = await request.post(
        `${config.API_URL}/admin/auth/users/${body.user.id}/impersonate`,
        {
          headers: {
            authorization: `Bearer ${operatorSession.token}`,
            'idempotency-key': 'e2e-impersonation-mint',
          },
          data: {reason: 'E2E support reproduction'},
        },
      );
      expect(replayAfterRevoke.status()).toBe(403);
      expect((await replayAfterRevoke.json()).code).toBe('forbidden');
    });
  },
);
