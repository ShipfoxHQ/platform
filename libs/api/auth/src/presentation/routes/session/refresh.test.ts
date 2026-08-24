import type {FastifyInstance} from 'fastify';
import {verifyUserToken} from '#core/jwt.js';
import {
  cookieHeader,
  createAuthTestApp,
  listMembershipsByUserMock,
  ROUTE_TEST_SECRET,
  resetCapturedMail,
  signupVerifyLogin,
} from '#test/routes.js';

describe('POST /auth/refresh', () => {
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

  test('returns a fresh access token and rotates the refresh cookie', async () => {
    const account = await signupVerifyLogin(app, 'refresh');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: cookieHeader(account.refreshCookie)},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeDefined();
    expect(res.json().user.email).toBe(account.email);
    // The refresh contract stays unmarked: the response never exposes
    // impersonator_id and rotation re-issues an ordinary access token.
    // refreshAccessToken signs from (user, memberships, sessionId) and never
    // sees the access token, so a marker cannot survive rotation here (ADR 0014
    // keeps impersonated sessions access-token-only; refresh restores the
    // administrator's session).
    expect(res.json().impersonator_id).toBeUndefined();
    const claims = await verifyUserToken({token: res.json().token, secret: ROUTE_TEST_SECRET});
    expect(claims.impersonatorId).toBeUndefined();
    expect(res.headers['set-cookie']).toContain('shipfox_refresh_token=');
    expect(res.headers['set-cookie']).toContain('HttpOnly');
    expect(res.headers['set-cookie']).toContain('Secure');
    expect(res.headers['set-cookie']).toContain('SameSite=Lax');
    expect(res.headers['set-cookie']).toContain('Path=/auth');
  });

  test('transforms missing refresh cookie into 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
    expect(res.headers['set-cookie']).toContain('shipfox_refresh_token=;');
  });

  test('tolerates a concurrent reuse within the grace window without rotating the cookie', async () => {
    const account = await signupVerifyLogin(app, 'refresh-concurrent');
    await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: cookieHeader(account.refreshCookie)},
    });

    const raced = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: cookieHeader(account.refreshCookie)},
    });

    // The racing tab gets a fresh access token but keeps the cookie the winning
    // refresh already installed, so no Set-Cookie is emitted.
    expect(raced.statusCode).toBe(200);
    expect(raced.json().token).toBeDefined();
    expect(raced.headers['set-cookie']).toBeUndefined();
  });

  test('transforms membership dependency outages into 503', async () => {
    const account = await signupVerifyLogin(app, 'refresh-workspaces-down');
    listMembershipsByUserMock.mockRejectedValueOnce(new Error('workspaces DB down'));

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: cookieHeader(account.refreshCookie)},
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('auth-dependency-unavailable');
    expect(res.headers['set-cookie']).toBeUndefined();

    const retry = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {cookie: cookieHeader(account.refreshCookie)},
    });

    expect(retry.statusCode).toBe(200);
    expect(retry.json().token).toBeDefined();
    expect(retry.headers['set-cookie']).toContain('shipfox_refresh_token=');
  });
});
