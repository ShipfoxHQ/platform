import fastify from 'fastify';
import {authCookiePlugin, getRefreshTokenCookie, setRefreshTokenCookie} from '#index.js';

vi.mock('#config.js', () => ({
  config: {
    AUTH_REFRESH_COOKIE_NAME: 'shipfox_refresh_token',
    AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS: 14,
    AUTH_PASSWORD_ENABLED: true,
    AUTH_SIGNUP_GATE_ENABLED: false,
    AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS: '',
    AUTH_SIGNUP_ALLOWED_EMAILS: '',
    AUTH_SIGNUP_NOT_ALLOWED_MESSAGE: undefined,
  },
}));

describe('auth cookie extension point', () => {
  test('a separately composed callback route can set and read the refresh cookie', async () => {
    const app = fastify();
    app.register(authCookiePlugin);
    app.post('/auth/callbacks/session', (_request, reply) => {
      setRefreshTokenCookie(reply, 'callback-refresh-token');
      reply.code(204).send();
    });
    app.get('/auth/callbacks/session', (request) => ({
      refresh_token: getRefreshTokenCookie(request) ?? null,
    }));
    await app.ready();

    const callback = await app.inject({method: 'POST', url: '/auth/callbacks/session'});
    const cookie = callback.headers['set-cookie'];
    const session = await app.inject({
      method: 'GET',
      url: '/auth/callbacks/session',
      headers: {cookie: Array.isArray(cookie) ? cookie[0] : cookie},
    });

    expect(callback.statusCode).toBe(204);
    expect(cookie).toContain('shipfox_refresh_token=callback-refresh-token');
    expect(cookie).toContain('Path=/auth');
    expect(session.json()).toEqual({refresh_token: 'callback-refresh-token'});

    await app.close();
  });
});
