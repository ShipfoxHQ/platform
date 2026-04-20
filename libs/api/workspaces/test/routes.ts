import type {OutgoingHttpHeaders} from 'node:http';
import {AUTH_USER, setUserContext} from '@shipfox/api-auth-context';
import type {AuthMethod} from '@shipfox/node-fastify';
import {createApp, type FastifyInstance} from '@shipfox/node-fastify';
import type {Mailer, MailMessage} from '@shipfox/node-mailer';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {createInvitation} from '#db/invitations.js';
import {createApiKeyAuthMethod} from '#presentation/auth/api-key-auth.js';
import {workspacesRoutes} from '#presentation/routes/index.js';

const testConfig = vi.hoisted(
  (): {
    captured: MailMessage[];
    mailer: Mailer;
    secret: string;
    clientBaseUrl: string;
  } => {
    const captured: MailMessage[] = [];
    const mailer: Mailer = {
      send: (message) => {
        captured.push(message);
        return Promise.resolve();
      },
    };
    return {
      captured,
      mailer,
      secret: 'route-tests-secret',
      clientBaseUrl: 'https://app.example.test',
    };
  },
);

vi.mock('#config.js', () => ({
  config: {
    CLIENT_BASE_URL: testConfig.clientBaseUrl,
  },
  mailer: testConfig.mailer,
}));

const TOKEN_RE = /token=([\w\-_=]+)/;
const BEARER_RE = /^Bearer /u;

export const ROUTE_TEST_SECRET = testConfig.secret;

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: async (request) => {
    await Promise.resolve();
    const raw = request.headers.authorization?.replace(BEARER_RE, '');
    const [userId, email] = raw?.startsWith('user:') ? raw.slice(5).split(':') : [];
    if (!userId || !email) throw new Error('Invalid test user token');
    setUserContext(request, {userId, email});
  },
};

export function resetCapturedMail(): void {
  testConfig.captured.length = 0;
}

export function capturedMail(): MailMessage[] {
  return testConfig.captured;
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

export function extractToken(url: string): string {
  const match = url.match(TOKEN_RE);
  expect(match?.[1]).toBeDefined();
  return match?.[1] ?? '';
}

export function getSetCookie(res: {headers: OutgoingHttpHeaders}): string {
  const header = res.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : typeof header === 'string' ? header : undefined;
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

export async function createWorkspacesTestApp(): Promise<FastifyInstance> {
  return await createApp({
    auth: [createApiKeyAuthMethod(), fakeUserAuth],
    routes: workspacesRoutes,
    swagger: false,
  });
}

export async function signup(
  app: FastifyInstance,
  params: {email: string; password: string; name?: string},
) {
  await Promise.resolve();
  void app;
  return {statusCode: 201, json: () => ({user: {id: crypto.randomUUID(), email: params.email}})};
}

export async function verifyEmail(app: FastifyInstance, email: string): Promise<void> {
  await Promise.resolve();
  void app;
  void email;
}

export async function login(app: FastifyInstance, params: {email: string; password: string}) {
  await Promise.resolve();
  void app;
  return {
    statusCode: 200,
    headers: {'set-cookie': 'shipfox_refresh_token=test; Path=/auth'},
    json: () => {
      const userId = crypto.randomUUID();
      return {token: `user:${userId}:${params.email}`, user: {id: userId}};
    },
  };
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
}> {
  await Promise.resolve();
  const email = uniqueEmail(prefix);
  const password = 'correct horse battery staple';
  void app;
  const userId = crypto.randomUUID();
  return {
    email,
    password,
    refreshCookie: 'shipfox_refresh_token=test; Path=/auth',
    token: `user:${userId}:${email}`,
    userId,
  };
}

export async function createWorkspace(
  app: FastifyInstance,
  token: string,
  name = `Workspace ${crypto.randomUUID()}`,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/workspaces',
    headers: {authorization: `Bearer ${token}`},
    payload: {name},
  });

  expect(res.statusCode).toBe(201);
  return res.json().id;
}

export async function createInvite(
  app: FastifyInstance,
  params: {token: string; workspaceId: string; email: string},
): Promise<{id: string; rawToken: string}> {
  const res = await app.inject({
    method: 'POST',
    url: `/workspaces/${params.workspaceId}/invitations`,
    headers: {authorization: `Bearer ${params.token}`},
    payload: {email: params.email},
  });

  expect(res.statusCode).toBe(201);
  return {
    id: res.json().id,
    rawToken: extractToken(latestMailTo(params.email).text ?? ''),
  };
}

export async function createExpiredInvite(params: {
  workspaceId: string;
  email: string;
  invitedByUserId: string;
}): Promise<string> {
  const rawToken = `expired-${crypto.randomUUID()}`;
  await createInvitation({
    workspaceId: params.workspaceId,
    email: params.email,
    hashedToken: hashOpaqueToken(rawToken),
    expiresAt: new Date(Date.now() - 60_000),
    invitedByUserId: params.invitedByUserId,
  });
  return rawToken;
}
