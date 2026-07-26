import {
  AUTH_PASSWORD_RESET_SEND_REQUESTED,
  AUTH_USER_SIGNED_UP,
  authEventSchemas,
} from '@shipfox/api-auth-dto';
import {createAuthModule} from './index.js';
import {passwordLoginMethods} from './login-methods.js';

vi.mock('#config.js', () => ({
  config: {
    AUTH_JWT_EXPIRES_IN: '15m',
    AUTH_JOB_LEASE_TOKEN_EXPIRES_IN: '90m',
    AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS: 14,
    AUTH_REFRESH_ROTATION_GRACE_SECONDS: 30,
    AUTH_REFRESH_COOKIE_NAME: 'shipfox_refresh_token',
    AUTH_PASSWORD_ENABLED: true,
    CLIENT_BASE_URL: 'https://app.example.test',
  },
}));

vi.mock('@shipfox/node-mailer', () => ({
  mailer: {send: vi.fn()},
}));

describe('authModule', () => {
  const signupPolicy = {
    isSignupAllowed: async () => ({allowed: true as const}),
  };
  const authModule = createAuthModule({
    workspaces: {
      listMembershipsForTokenClaims: vi.fn(),
      getWorkspaceCreator: vi.fn(),
      preflightInvitationAcceptance: vi.fn(),
      acceptInvitation: vi.fn(),
      requireActiveMembership: vi.fn(),
    },
    signupPolicy,
  });
  test('declares password login only when password login is enabled', () => {
    expect(passwordLoginMethods(true)).toEqual([{id: 'password'}]);
    expect(passwordLoginMethods(false)).toEqual([]);
    expect(authModule.loginMethods).toEqual([{id: 'password'}]);
  });

  test('registers auth email outbox publisher and subscribers', () => {
    const publisher = authModule.publishers?.find((pub) => pub.name === 'auth');
    const events = authModule.subscribers?.map((subscriber) => subscriber.event);

    expect(publisher?.eventSchemas).toBe(authEventSchemas);
    expect(Object.keys(publisher?.eventSchemas ?? {}).sort()).toEqual([
      AUTH_PASSWORD_RESET_SEND_REQUESTED,
      AUTH_USER_SIGNED_UP,
    ]);
    expect(events).toEqual(expect.arrayContaining([AUTH_PASSWORD_RESET_SEND_REQUESTED]));
  });
});
