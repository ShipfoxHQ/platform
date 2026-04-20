import type {OutgoingHttpHeaders} from 'node:http';
import {createApp, type FastifyInstance} from '@shipfox/node-fastify';
import type {Mailer, MailMessage} from '@shipfox/node-mailer';
import {createJwtAuthMethod} from '#presentation/auth/jwt-auth.js';
import {authRoutes} from '#presentation/routes/index.js';

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
    AUTH_JWT_SECRET: testConfig.secret,
    AUTH_JWT_EXPIRES_IN: '15m',
    AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS: 14,
    AUTH_REFRESH_COOKIE_NAME: 'shipfox_refresh_token',
    CLIENT_BASE_URL: testConfig.clientBaseUrl,
  },
  mailer: testConfig.mailer,
}));

const TOKEN_RE = /token=([\w\-_=]+)/;

export const ROUTE_TEST_SECRET = testConfig.secret;

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

export async function createAuthTestApp(): Promise<FastifyInstance> {
  return await createApp({
    auth: [createJwtAuthMethod()],
    routes: [authRoutes],
    swagger: false,
  });
}

export async function signup(
  app: FastifyInstance,
  params: {email: string; password: string; name?: string},
) {
  return await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: params,
  });
}

export async function verifyEmail(app: FastifyInstance, email: string): Promise<void> {
  const token = extractToken(latestMailTo(email).text ?? '');

  const res = await app.inject({
    method: 'POST',
    url: '/auth/verify-email/confirm',
    payload: {token},
  });

  expect(res.statusCode).toBe(200);
}

export async function login(app: FastifyInstance, params: {email: string; password: string}) {
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
}> {
  const email = uniqueEmail(prefix);
  const password = 'correct horse battery staple';
  await signup(app, {email, password, name: prefix});
  await verifyEmail(app, email);

  const loginRes = await login(app, {email, password});

  expect(loginRes.statusCode).toBe(200);
  return {
    email,
    password,
    refreshCookie: getSetCookie(loginRes),
    token: loginRes.json().token,
    userId: loginRes.json().user.id,
  };
}
