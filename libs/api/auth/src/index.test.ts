import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  AUTH_PASSWORD_RESET_SEND_REQUESTED,
  AUTH_USER_SIGNED_UP,
  authEventSchemas,
} from '@shipfox/api-auth-dto';
import {ADMINISTRATION_ACTION_PERFORMED} from '@shipfox/api-common-dto';
import {createAuthMaintenanceActivities} from '#temporal/activities/index.js';
import {createAuthModule} from './index.js';
import {passwordLoginMethods} from './login-methods.js';

const expectedWorkflowsPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist/temporal/workflows/index.js',
);

type SignupPolicyLike = {
  isSignupAllowed(params: {
    email: string;
    emailVerified: boolean;
    source: string;
  }): Promise<{allowed: true} | {allowed: false; message?: string}>;
};

const buildAuthRoutes = vi.hoisted(() =>
  vi.fn((_passwordEnabled: boolean, _workspaces: unknown, _signupPolicy?: SignupPolicyLike) => ({
    prefix: '/auth',
    plugins: [],
    routes: [],
  })),
);

vi.mock('#config.js', () => ({
  config: {
    AUTH_JWT_EXPIRES_IN: '15m',
    AUTH_JOB_LEASE_TOKEN_EXPIRES_IN: '90m',
    AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS: 14,
    AUTH_REFRESH_ROTATION_GRACE_SECONDS: 30,
    AUTH_REFRESH_COOKIE_NAME: 'shipfox_refresh_token',
    AUTH_PASSWORD_ENABLED: true,
    AUTH_SIGNUP_GATE_ENABLED: true,
    AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS: 'example.com',
    AUTH_SIGNUP_ALLOWED_EMAILS: '',
    AUTH_SIGNUP_NOT_ALLOWED_MESSAGE: undefined,
    API_PUBLIC_URL: 'https://api.example.test',
    CLIENT_BASE_URL: 'https://app.example.test',
  },
}));

vi.mock('#presentation/routes/index.js', () => ({buildAuthRoutes}));

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
      getWorkspaceOperatingState: vi.fn(),
    },
    signupPolicy,
  });
  test('declares password login only when password login is enabled', () => {
    expect(passwordLoginMethods(true)).toEqual([{id: 'password'}]);
    expect(passwordLoginMethods(false)).toEqual([]);
    expect(authModule.loginMethods).toEqual([{id: 'password'}]);
  });

  test('uses the environment signup policy when none is provided', async () => {
    buildAuthRoutes.mockClear();
    const module = createAuthModule({
      workspaces: {
        listMembershipsForTokenClaims: vi.fn(),
        getWorkspaceCreator: vi.fn(),
        preflightInvitationAcceptance: vi.fn(),
        acceptInvitation: vi.fn(),
        requireActiveMembership: vi.fn(),
        getWorkspaceOperatingState: vi.fn(),
      },
    });
    expect(module.routes).toHaveLength(8);
    expect(module.routes).toEqual(
      expect.arrayContaining([expect.objectContaining({prefix: '/admin/auth'})]),
    );
    const signupPolicy = buildAuthRoutes.mock.calls[0]?.[2];

    expect(signupPolicy).toEqual(expect.objectContaining({isSignupAllowed: expect.any(Function)}));
    await expect(
      signupPolicy?.isSignupAllowed({
        email: 'person@other.example',
        emailVerified: false,
        source: 'password',
      }),
    ).resolves.toEqual({
      allowed: false,
      message: 'This Shipfox deployment does not accept new accounts right now.',
      format: 'markdown',
    });
  });

  test('registers auth email outbox publisher and subscribers', () => {
    const publisher = authModule.publishers?.find((pub) => pub.name === 'auth');
    const events = authModule.subscribers?.map((subscriber) => subscriber.event);

    expect(publisher?.eventSchemas).not.toBe(authEventSchemas);
    expect(Object.keys(publisher?.eventSchemas ?? {}).sort()).toEqual([
      ADMINISTRATION_ACTION_PERFORMED,
      AUTH_PASSWORD_RESET_SEND_REQUESTED,
      AUTH_USER_SIGNED_UP,
    ]);
    expect(events).toEqual(expect.arrayContaining([AUTH_PASSWORD_RESET_SEND_REQUESTED]));
  });

  test('registers the agent-access retention worker', () => {
    const worker = authModule.workers?.[0];
    expect(worker).toEqual(
      expect.objectContaining({
        taskQueue: 'auth-agent-access-maintenance',
        workflowsPath: expectedWorkflowsPath,
        workflows: [
          {
            name: 'agentAccessRetentionCron',
            id: 'auth-agent-access-retention',
            cronSchedule: '10 * * * *',
          },
        ],
      }),
    );
    expect(worker?.activities).toBe(createAuthMaintenanceActivities);
  });

  test('activates the agent access authentication and route surface', () => {
    expect(authModule.auth?.map(({name}) => name)).toContain('agent-access');
    expect(authModule.routes).toEqual(
      expect.arrayContaining([expect.objectContaining({prefix: '/agent-access'})]),
    );
    expect(authModule.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prefix: '',
          routes: expect.arrayContaining([
            expect.objectContaining({path: '/.well-known/oauth-protected-resource'}),
            expect.objectContaining({path: '/.well-known/oauth-authorization-server'}),
            expect.objectContaining({path: '/oauth/register'}),
          ]),
        }),
        expect.objectContaining({
          prefix: '',
          routes: expect.arrayContaining([
            expect.objectContaining({path: '/oauth/authorize'}),
            expect.objectContaining({path: '/oauth/token'}),
          ]),
        }),
      ]),
    );
  });
});
