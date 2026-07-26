import {createApp} from '@shipfox/node-fastify';
import {createJwtAuthMethod} from '#presentation/auth/jwt-auth.js';
import {buildAuthRoutes} from './index.js';

const workspaces = {
  listMembershipsForTokenClaims: vi.fn(() => Promise.resolve({memberships: []})),
  getWorkspaceCreator: vi.fn(),
  preflightInvitationAcceptance: vi.fn(),
  acceptInvitation: vi.fn(),
  requireActiveMembership: vi.fn(),
  getWorkspaceOperatingState: vi.fn(),
};

const disabledPasswordPaths = [
  '/auth/signup',
  '/auth/verify-email/confirm',
  '/auth/verify-email/resend',
  '/auth/login',
  '/auth/change-password',
  '/auth/password-reset',
  '/auth/password-reset/confirm',
];

describe('buildAuthRoutes', () => {
  test('preserves the default route table when password login is enabled', () => {
    const routes = buildAuthRoutes(true, workspaces);

    expect(routes.routes.map((route) => ('path' in route ? route.path : route.prefix))).toEqual([
      '/signup',
      '/verify-email/confirm',
      '/verify-email/resend',
      '/login',
      '/refresh',
      '/logout',
      '/me',
      '/change-password',
      '/password-reset',
      '/password-reset/confirm',
    ]);
  });

  test('keeps only session lifecycle routes when password login is disabled', () => {
    const routes = buildAuthRoutes(false, workspaces);

    expect(routes.routes.map((route) => ('path' in route ? route.path : route.prefix))).toEqual([
      '/refresh',
      '/logout',
      '/me',
    ]);
  });

  test('does not register password or email-verification routes when password login is disabled', async () => {
    const app = await createApp({
      auth: [createJwtAuthMethod()],
      routes: [buildAuthRoutes(false, workspaces)],
      swagger: false,
    });

    try {
      for (const url of disabledPasswordPaths) {
        const response = await app.inject({method: 'POST', url});
        expect(response.statusCode).toBe(404);
      }

      const refresh = await app.inject({method: 'POST', url: '/auth/refresh'});
      const logout = await app.inject({method: 'POST', url: '/auth/logout'});
      const me = await app.inject({method: 'GET', url: '/auth/me'});

      expect(refresh.statusCode).not.toBe(404);
      expect(logout.statusCode).not.toBe(404);
      expect(me.statusCode).not.toBe(404);
    } finally {
      await app.close();
    }
  });
});
