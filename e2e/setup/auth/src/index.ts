import {createHash, randomBytes} from 'node:crypto';
import type {
  E2eCreateSessionBodyDto,
  E2eCreateSessionResponseDto,
  E2eCreateUserBodyDto,
  E2eCreateUserResponseDto,
  E2eSessionDto,
} from '@shipfox/api-auth-dto';
import {
  type OAuthTokenResponseDto,
  oauthConsentDecisionResponseSchema,
  oauthConsentResponseSchema,
  oauthDynamicClientRegistrationResponseSchema,
  oauthTokenResponseSchema,
} from '@shipfox/api-auth-dto';
import {config, request, requestJson} from '@shipfox/e2e-core';
import type {APIRequestContext, BrowserContext, Page} from '@shipfox/playwright';

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

function parseSetCookie(setCookie: string): {name: string; value: string; path: string} {
  const segments = setCookie.split(';').map((segment) => segment.trim());
  const [pair] = segments;
  if (!pair) throw new Error('Set-Cookie header did not include a cookie');
  const separator = pair.indexOf('=');
  if (separator === -1) throw new Error('Set-Cookie header did not include a cookie value');

  const pathSegment = segments.find((segment) => segment.toLowerCase().startsWith('path='));

  return {
    name: pair.slice(0, separator),
    value: pair.slice(separator + 1),
    // Honour the server's Path: a URL-derived path collapses `/auth` to `/`,
    // leaving a duplicate cookie the server never rotates.
    path: pathSegment ? pathSegment.slice('path='.length) : '/',
  };
}

async function addRefreshCookie(params: {
  context: BrowserContext;
  apiUrl: string;
  setCookie: string;
}): Promise<void> {
  const {name, value, path} = parseSetCookie(params.setCookie);
  const apiUrl = new URL(params.apiUrl);
  await params.context.addCookies([
    {
      name,
      value,
      domain: apiUrl.hostname,
      path,
      httpOnly: true,
      secure: apiUrl.protocol === 'https:',
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

export interface AgentAccessConsentRequestOptions {
  request: APIRequestContext;
  apiOrigin: string;
  publicOrigin: string;
  clientName: string;
  redirectUri: string;
  statePrefix?: string | undefined;
}

export interface AgentAccessConsentRequest {
  clientId: string;
  codeVerifier: string;
  requestId: string;
  state: string;
}

export async function requestAgentAccessConsent(
  options: AgentAccessConsentRequestOptions,
): Promise<AgentAccessConsentRequest> {
  const registration = await options.request.post(`${options.apiOrigin}/oauth/register`, {
    data: {
      client_name: options.clientName,
      redirect_uris: [options.redirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'read',
    },
    failOnStatusCode: false,
  });
  if (registration.status() !== 201) {
    throw new Error(`OAuth client registration returned ${registration.status()}, expected 201`);
  }
  const registeredClient = oauthDynamicClientRegistrationResponseSchema.parse(
    await registration.json(),
  );

  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state = `${options.statePrefix ?? 'e2e'}-${randomBytes(12).toString('hex')}`;
  const authorizationUrl = new URL(`${options.apiOrigin}/oauth/authorize`);
  authorizationUrl.search = new URLSearchParams({
    client_id: registeredClient.client_id,
    response_type: 'code',
    redirect_uri: options.redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    resource: `${options.publicOrigin}/mcp`,
    scope: 'read',
    state,
  }).toString();
  const authorization = await options.request.get(authorizationUrl.toString(), {
    failOnStatusCode: false,
    maxRedirects: 0,
  });
  if (authorization.status() !== 302) {
    throw new Error(`OAuth authorization returned ${authorization.status()}, expected 302`);
  }
  const consentLocation = authorization.headers().location;
  if (!consentLocation) throw new Error('OAuth authorization did not return a consent location');
  const requestId = new URL(consentLocation, options.apiOrigin).searchParams.get('request_id');
  if (!requestId) throw new Error('OAuth authorization did not return a consent request id');

  return {
    clientId: registeredClient.client_id,
    codeVerifier,
    requestId,
    state,
  };
}

export interface AgentAccessAuthorizationOptions extends AgentAccessConsentRequestOptions {
  sessionToken: string;
  workspaceId: string;
}

export async function authorizeAgentAccess(
  options: AgentAccessAuthorizationOptions,
): Promise<OAuthTokenResponseDto> {
  const authorization = await requestAgentAccessConsent(options);
  const consent = await options.request.get(
    `${options.apiOrigin}/oauth/consents/${authorization.requestId}`,
    {
      headers: {authorization: `Bearer ${options.sessionToken}`},
      failOnStatusCode: false,
    },
  );
  if (consent.status() !== 200) {
    throw new Error(`OAuth consent detail returned ${consent.status()}, expected 200`);
  }
  const consentBody = oauthConsentResponseSchema.parse(await consent.json());
  if (
    consentBody.client_name !== options.clientName ||
    !consentBody.is_loopback_redirect ||
    !consentBody.workspaces.some(({workspace_id}) => workspace_id === options.workspaceId)
  ) {
    throw new Error(
      'OAuth consent detail did not match the requested loopback client and workspace',
    );
  }

  const approval = await options.request.post(
    `${options.apiOrigin}/oauth/consents/${authorization.requestId}/approve`,
    {
      headers: {authorization: `Bearer ${options.sessionToken}`},
      data: {workspace_id: options.workspaceId},
      failOnStatusCode: false,
    },
  );
  if (approval.status() !== 200) {
    throw new Error(`OAuth consent approval returned ${approval.status()}, expected 200`);
  }
  const approvalBody = oauthConsentDecisionResponseSchema.parse(await approval.json());
  const approvedLocation = new URL(approvalBody.redirect_url);
  const code = approvedLocation.searchParams.get('code');
  if (
    approvedLocation.origin !== new URL(options.redirectUri).origin ||
    approvedLocation.searchParams.get('state') !== authorization.state ||
    !code
  ) {
    throw new Error('OAuth consent approval returned an invalid client redirect');
  }

  const token = await options.request.post(`${options.apiOrigin}/oauth/token`, {
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    data: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: authorization.clientId,
      code,
      redirect_uri: options.redirectUri,
      code_verifier: authorization.codeVerifier,
      resource: `${options.publicOrigin}/mcp`,
    }).toString(),
    failOnStatusCode: false,
  });
  if (token.status() !== 200) {
    throw new Error(`OAuth token exchange returned ${token.status()}, expected 200`);
  }
  return oauthTokenResponseSchema.parse(await token.json());
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
