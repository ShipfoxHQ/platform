import type {
  E2eCreateSessionBodyDto,
  E2eCreateSessionResponseDto,
  E2eCreateUserBodyDto,
  E2eCreateUserResponseDto,
  E2eSessionDto,
} from '@shipfox/api-auth-dto';
import {config, request, requestJson} from '@shipfox/e2e-core';
import type {BrowserContext, Page} from '@shipfox/playwright';

const DEFAULT_PASSWORD_PREFIX = 'e2e-password';

export type {
  E2eCreateSessionBodyDto,
  E2eCreateUserBodyDto,
  E2eCreateUserResponseDto,
  E2eSessionDto,
} from '@shipfox/api-auth-dto';

export function generateUser(params: Partial<E2eCreateUserBodyDto> = {}): E2eCreateUserBodyDto {
  return {
    email: params.email ?? `e2e-${crypto.randomUUID()}@example.test`,
    password: params.password ?? `${DEFAULT_PASSWORD_PREFIX}-${crypto.randomUUID()}`,
    verified: params.verified ?? true,
    name: params.name ?? `E2E User ${crypto.randomUUID()}`,
  };
}

export async function createUser(
  params: Partial<E2eCreateUserBodyDto> = {},
): Promise<E2eCreateUserResponseDto> {
  return await requestJson<E2eCreateUserResponseDto>('post', '/__e2e/auth/users', {
    json: generateUser(params),
  });
}

export async function createSession(params: E2eCreateSessionBodyDto): Promise<E2eSessionDto> {
  const response = await request<E2eCreateSessionResponseDto>('post', '/__e2e/auth/sessions', {
    json: params,
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('E2E session endpoint did not set a refresh cookie');

  return {...(await response.json<E2eCreateSessionResponseDto>()), setCookie};
}

function cookieNameValue(setCookie: string): {name: string; value: string} {
  const [cookie] = setCookie.split(';');
  if (!cookie) throw new Error('Set-Cookie header did not include a cookie');
  const separator = cookie.indexOf('=');
  if (separator === -1) throw new Error('Set-Cookie header did not include a cookie value');

  return {
    name: cookie.slice(0, separator),
    value: cookie.slice(separator + 1),
  };
}

async function addRefreshCookie(params: {
  context: BrowserContext;
  apiUrl: string;
  setCookie: string;
}): Promise<void> {
  const {name, value} = cookieNameValue(params.setCookie);
  await params.context.addCookies([
    {
      name,
      value,
      url: new URL('/auth', params.apiUrl).toString(),
      httpOnly: true,
      secure: params.setCookie.includes('Secure'),
      sameSite: 'Lax',
    },
  ]);
}

export async function loginAs(page: Page, user: E2eCreateUserResponseDto): Promise<void> {
  const session = await createSession({user_id: user.user.id});
  await addRefreshCookie({
    context: page.context(),
    apiUrl: config.API_URL,
    setCookie: session.setCookie,
  });
}

function createRunId(): string {
  return `e2e-auth-${Date.now()}-${crypto.randomUUID()}`;
}

export function createAuthHelper() {
  return {
    runId: createRunId(),
    have: {
      session: createSession,
      user: createUser,
    },
    createSession,
    createUser,
    generateUser,
    loginAs,
  };
}

export type AuthHelper = ReturnType<typeof createAuthHelper>;

export interface AuthFixtures {
  auth: AuthHelper;
}

export const authHelper = {
  auth: async (
    {request: _request}: {request: unknown},
    use: (helper: AuthHelper) => Promise<void>,
  ) => {
    await use(createAuthHelper());
  },
};
