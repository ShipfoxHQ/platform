import type {OutgoingHttpHeaders} from 'node:http';
import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {withSlugSuffix} from '@shipfox/api-common-dto';
import {WORKSPACES_INVITATION_SEND_REQUESTED} from '@shipfox/api-workspaces-dto';
import type {AppConfig, AuthMethod} from '@shipfox/node-fastify';
import {ClientError, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import type {Mailer, MailMessage} from '@shipfox/node-mailer';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {and, desc, eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {createInvitation} from '#db/invitations.js';
import {listMembershipsByUser} from '#db/memberships.js';
import {workspacesOutbox} from '#db/schema/outbox.js';
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
let workspaceSlugSequence = 1;

export const ROUTE_TEST_SECRET = testConfig.secret;

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: async (request) => {
    const raw = request.headers.authorization?.replace(BEARER_RE, '');
    if (!raw) {
      throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    }
    if (raw?.startsWith('claim:')) {
      const [, userId, email, workspaceId, status] = raw.split(':');
      if (!userId || !email || !workspaceId) throw new Error('Invalid test user claim token');
      const workspaceStatus = status === 'suspended' || status === 'deleted' ? status : 'active';
      setUserContext(
        request,
        buildUserContext({
          userId,
          email,
          memberships: [{workspaceId, role: 'admin', workspaceStatus}],
        }),
      );
      return;
    }

    const [userId, email, encodedName] = raw?.startsWith('user:') ? raw.slice(5).split(':') : [];
    if (!userId || !email) throw new Error('Invalid test user token');
    const memberships = await listMembershipsByUser({userId});
    setUserContext(
      request,
      buildUserContext({
        userId,
        email,
        name: encodedName ? decodeURIComponent(encodedName) : null,
        memberships: memberships.map((m) => ({
          workspaceId: m.workspaceId,
          role: 'admin' as const,
          workspaceStatus: 'active' as const,
        })),
      }),
    );
  },
};

export function resetCapturedMail(): void {
  testConfig.captured.length = 0;
}

export function capturedMail(): MailMessage[] {
  return testConfig.captured;
}

export async function invitationOutboxEventsTo(email: string) {
  return await db()
    .select()
    .from(workspacesOutbox)
    .where(
      and(
        eq(workspacesOutbox.eventType, WORKSPACES_INVITATION_SEND_REQUESTED),
        sql`${workspacesOutbox.payload}->>'email' = ${email}`,
      ),
    )
    .orderBy(desc(workspacesOutbox.createdAt));
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

export async function latestInvitationLinkTo(email: string): Promise<string> {
  const event = (await invitationOutboxEventsTo(email))[0];
  expect(event).toBeDefined();
  const payload = event?.payload as {inviteLink?: string} | undefined;
  expect(payload?.inviteLink).toBeDefined();
  return payload?.inviteLink ?? '';
}

export async function createWorkspacesTestApp(
  options: Pick<AppConfig, 'fastifyOptions'> = {},
): Promise<FastifyInstance> {
  return await createApp({
    ...options,
    auth: [fakeUserAuth],
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
  options: {name?: string} = {},
): Promise<{
  email: string;
  name: string | null;
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
  const name = options.name ?? null;
  const tokenName = name ? `:${encodeURIComponent(name)}` : '';
  return {
    email,
    name,
    password,
    refreshCookie: 'shipfox_refresh_token=test; Path=/auth',
    token: `user:${userId}:${email}${tokenName}`,
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
    payload: {
      name,
      slug: withSlugSuffix(
        `route-workspace-${crypto.randomUUID().slice(0, 8)}`,
        workspaceSlugSequence++,
      ),
    },
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
    rawToken: extractToken(await latestInvitationLinkTo(params.email)),
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
    skipEmail: true,
  });
  return rawToken;
}
