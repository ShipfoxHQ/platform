import type {OutgoingHttpHeaders} from 'node:http';
import type {AUTH_PASSWORD_RESET_SEND_REQUESTED} from '@shipfox/api-auth-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {userAccessTokenKey} from '@shipfox/node-auth-root-key';
import {type AppConfig, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import type {Mailer, MailMessage} from '@shipfox/node-mailer';
import {and, desc, eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {authOutbox} from '#db/schema/outbox.js';
import {createJwtAuthMethod} from '#presentation/auth/jwt-auth.js';
import {
  administrationBootstrapRoutes,
  administrationRoutes,
  createAdministrationUserRoutes,
} from '#presentation/routes/administration.js';
import {buildAuthRoutes} from '#presentation/routes/index.js';

const testConfig = vi.hoisted(
  (): {
    captured: MailMessage[];
    challenges: Map<string, string>;
    mailer: Mailer;
    clientBaseUrl: string;
    authConfig: {
      ADMIN_BOOTSTRAP_TOKEN: string;
      AUTH_JWT_EXPIRES_IN: string;
      AUTH_IMPERSONATION_ENABLED: boolean;
      AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS: number;
      AUTH_REFRESH_ROTATION_GRACE_SECONDS: number;
      AUTH_REFRESH_COOKIE_NAME: string;
      AUTH_PASSWORD_ENABLED: boolean;
      AUTH_SIGNUP_GATE_ENABLED: boolean;
      AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS: string;
      AUTH_SIGNUP_ALLOWED_EMAILS: string;
      AUTH_SIGNUP_NOT_ALLOWED_MESSAGE: string | undefined;
      CLIENT_BASE_URL: string;
    };
  } => {
    const captured: MailMessage[] = [];
    const mailer: Mailer = {
      send: (message) => {
        captured.push(message);
        return Promise.resolve();
      },
    };
    const authConfig = {
      ADMIN_BOOTSTRAP_TOKEN: 'test-bootstrap-token',
      AUTH_JWT_EXPIRES_IN: '15m',
      AUTH_IMPERSONATION_ENABLED: true,
      AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS: 14,
      AUTH_REFRESH_ROTATION_GRACE_SECONDS: 30,
      AUTH_REFRESH_COOKIE_NAME: 'shipfox_refresh_token',
      AUTH_PASSWORD_ENABLED: true,
      AUTH_SIGNUP_GATE_ENABLED: false,
      AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS: '',
      AUTH_SIGNUP_ALLOWED_EMAILS: '',
      AUTH_SIGNUP_NOT_ALLOWED_MESSAGE: undefined,
      CLIENT_BASE_URL: 'https://app.example.test',
    };
    return {
      captured,
      challenges: new Map(),
      mailer,
      clientBaseUrl: authConfig.CLIENT_BASE_URL,
      authConfig,
    };
  },
);

const workspaceTestDoubles = vi.hoisted(() => {
  return {
    acceptInvitation: vi.fn(),
    getWorkspaceCreator: vi.fn(),
    preflightInvitationAcceptance: vi.fn(),
    listMembershipsForTokenClaims: vi.fn(() => Promise.resolve({memberships: []})),
    requireActiveMembership: vi.fn(),
  };
}) as {
  [Method in keyof WorkspacesInterModuleClient]: ReturnType<typeof vi.fn>;
};
const workspaces = workspaceTestDoubles as unknown as WorkspacesInterModuleClient;

vi.mock('#config.js', () => ({
  config: testConfig.authConfig,
  mailer: testConfig.mailer,
}));

vi.mock('@shipfox/node-mailer', () => ({mailer: testConfig.mailer}));

const CODE_RE = /\b\d{8}\b/u;
const TOKEN_RE = /token=([\w\-_=]+)/;
type AuthEmailEventType = typeof AUTH_PASSWORD_RESET_SEND_REQUESTED;
type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

export const ROUTE_TEST_SECRET = userAccessTokenKey();
export const acceptWorkspaceInvitationMock: ReturnType<typeof vi.fn> =
  workspaceTestDoubles.acceptInvitation;
export const peekInvitationByRawTokenMock: ReturnType<typeof vi.fn> =
  workspaceTestDoubles.preflightInvitationAcceptance;
export const listMembershipsByUserMock: ReturnType<typeof vi.fn> =
  workspaceTestDoubles.listMembershipsForTokenClaims;

export function resetCapturedMail(): void {
  testConfig.captured.length = 0;
  testConfig.challenges.clear();
  acceptWorkspaceInvitationMock.mockReset();
  peekInvitationByRawTokenMock.mockReset();
  listMembershipsByUserMock.mockReset();
  listMembershipsByUserMock.mockResolvedValue({memberships: []});
}

/** Flips `AUTH_IMPERSONATION_ENABLED` for the shared route-test config mock. */
export function setImpersonationEnabled(enabled: boolean): void {
  testConfig.authConfig.AUTH_IMPERSONATION_ENABLED = enabled;
}

/** Flips `AUTH_JWT_EXPIRES_IN` for the shared route-test config mock. */
export function setAuthJwtExpiresIn(expiresIn: string): void {
  testConfig.authConfig.AUTH_JWT_EXPIRES_IN = expiresIn;
}

export function capturedMail(): MailMessage[] {
  return testConfig.captured;
}

export async function outboxEventsTo(email: string, eventType: AuthEmailEventType) {
  return await db()
    .select()
    .from(authOutbox)
    .where(
      and(eq(authOutbox.eventType, eventType), sql`${authOutbox.payload}->>'email' = ${email}`),
    )
    .orderBy(desc(authOutbox.createdAt));
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

export function latestVerificationCode(email: string): string {
  const code = latestMailTo(email).text?.match(CODE_RE)?.[0];
  expect(code).toBeDefined();
  return code ?? '';
}

export function extractToken(url: string): string {
  const match = url.match(TOKEN_RE);
  expect(match?.[1]).toBeDefined();
  return match?.[1] ?? '';
}

export function getSetCookie(res: {headers: OutgoingHttpHeaders}): string {
  const header = res.headers['set-cookie'];
  let value: string | undefined;
  if (Array.isArray(header)) value = header[0];
  else if (typeof header === 'string') value = header;
  expect(value).toBeDefined();
  return value ?? '';
}

export function cookieHeader(setCookie: string): string {
  const [cookie] = setCookie.split(';');
  expect(cookie).toBeDefined();
  return cookie ?? '';
}

export function latestMailTo(email: string): MailMessage {
  const message = [...testConfig.captured].reverse().find((mail) => mail.to === email);
  expect(message).toBeDefined();
  return message as MailMessage;
}

export async function latestEmailLinkTo(
  email: string,
  eventType: AuthEmailEventType,
): Promise<string> {
  const event = (await outboxEventsTo(email, eventType))[0];
  expect(event).toBeDefined();
  const payload = event?.payload as {verifyLink?: string; resetLink?: string} | undefined;
  const link = payload?.resetLink;
  expect(link).toBeDefined();
  return link ?? '';
}

export async function createAuthTestApp(params?: {
  fastifyOptions?: AppConfig['fastifyOptions'];
}): Promise<FastifyInstance> {
  const appConfig: AppConfig = {
    auth: [createJwtAuthMethod()],
    routes: [
      buildAuthRoutes(true, workspaces),
      administrationBootstrapRoutes,
      administrationRoutes,
      ...createAdministrationUserRoutes(workspaces),
    ],
    swagger: false,
  };
  if (params?.fastifyOptions) appConfig.fastifyOptions = params.fastifyOptions;
  return await createApp(appConfig);
}

export async function signup(
  app: FastifyInstance,
  params: {email: string; password: string; name?: string},
): Promise<InjectResponse> {
  const result = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: {name: 'Test User', ...params},
  });
  const challengeId = result.json().email_challenge?.id;
  if (typeof challengeId === 'string')
    testConfig.challenges.set(params.email.trim().toLowerCase(), challengeId);
  return result;
}

export async function verifyEmail(
  app: FastifyInstance,
  email: string,
  challengeId = testConfig.challenges.get(email) ?? '',
): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/verify-email/confirm',
    payload: {email, challenge_id: challengeId, code: latestVerificationCode(email)},
  });

  expect(res.statusCode).toBe(200);
}

export async function login(
  app: FastifyInstance,
  params: {email: string; password: string},
): Promise<InjectResponse> {
  return await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: params,
  });
}

export async function signupVerifyLogin(
  app: FastifyInstance,
  prefix: string,
): Promise<{
  email: string;
  password: string;
  refreshCookie: string;
  token: string;
  userId: string;
  emailChallengeId: string;
}> {
  const email = uniqueEmail(prefix);
  const password = 'correct horse battery staple';
  const signupResult = await signup(app, {email, password, name: prefix});
  const emailChallengeId = signupResult.json().email_challenge.id;
  await verifyEmail(app, email, emailChallengeId);

  const loginRes = await login(app, {email, password});

  expect(loginRes.statusCode).toBe(200);
  return {
    email,
    password,
    refreshCookie: getSetCookie(loginRes),
    token: loginRes.json().token,
    userId: loginRes.json().user.id,
    emailChallengeId,
  };
}

export async function createVerifiedSession(prefix: string): Promise<{
  email: string;
  password: string;
  refreshCookie: string;
  token: string;
  userId: string;
}> {
  const {createUser, createSessionForUser} = await import('#core/auth.js');
  const email = uniqueEmail(prefix);
  const password = 'correct horse battery staple';
  const user = await createUser({email, password, name: prefix, verified: true});
  const session = await createSessionForUser({userId: user.id, workspaces});

  return {
    email,
    password,
    refreshCookie: `shipfox_refresh_token=${session.refreshToken}`,
    token: session.token,
    userId: user.id,
  };
}
