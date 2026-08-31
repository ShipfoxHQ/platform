import {jiraWebhookEventNames} from '@shipfox/api-integration-jira-dto';
import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError, TimeoutError} from 'ky';
import {config} from '#config.js';
import {JiraIntegrationProviderError} from '#core/errors.js';

const JIRA_API_TIMEOUT_MS = 10_000;
const SCOPE_SEPARATOR_RE = /[,\s]+/;
const TRAILING_SLASHES_RE = /\/+$/;
export const JIRA_DYNAMIC_WEBHOOK_EVENTS = jiraWebhookEventNames;
// Jira rejects an empty dynamic-webhook filter; every issue belongs to a project.
export const JIRA_DYNAMIC_WEBHOOK_JQL = 'project != null';

export interface JiraAuthorization {
  accessToken: string;
  refreshToken?: string | undefined;
  expiresAt?: Date | undefined;
  scopes: string[];
}

export interface JiraAccessibleResource {
  cloudId: string;
  name: string;
  url: string;
  scopes: string[];
}

export interface JiraIdentity {
  accountId: string;
}

export interface JiraDynamicWebhookRegistration {
  webhookId: number;
}

export type JiraAgentToolHttpMethod = 'GET' | 'POST' | 'PUT';

export type JiraAgentToolQueryValue =
  | string
  | number
  | boolean
  | readonly (string | number)[]
  | undefined;

export interface JiraAgentToolRequest {
  accessToken: string;
  cloudId: string;
  method: JiraAgentToolHttpMethod;
  path: string;
  query?: Record<string, JiraAgentToolQueryValue> | undefined;
  body?: unknown;
  operation?: string | undefined;
}

export interface JiraAgentToolResponse {
  status: number;
  body: unknown;
}

export interface JiraAgentToolsClient {
  request(input: JiraAgentToolRequest): Promise<JiraAgentToolResponse>;
}

export interface JiraApiClient {
  exchangeAuthorizationCode(input: {code: string}): Promise<JiraAuthorization>;
  refreshAccessToken(input: {refreshToken: string}): Promise<JiraAuthorization>;
  getAccessibleResources(input: {accessToken: string}): Promise<JiraAccessibleResource[]>;
  getMyself(input: {accessToken: string; cloudId: string}): Promise<JiraIdentity>;
  registerDynamicWebhook(input: {
    accessToken: string;
    cloudId: string;
    url: string;
  }): Promise<JiraDynamicWebhookRegistration>;
  refreshDynamicWebhooks(input: {
    accessToken: string;
    cloudId: string;
    webhookIds: number[];
  }): Promise<Date | undefined>;
  deleteDynamicWebhooks(input: {
    accessToken: string;
    cloudId: string;
    webhookIds: number[];
  }): Promise<void>;
  deleteDynamicWebhook(input: {
    accessToken: string;
    cloudId: string;
    webhookId: number;
  }): Promise<void>;
}

interface JiraTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

interface JiraResourceResponse {
  id?: unknown;
  name?: unknown;
  url?: unknown;
  scopes?: unknown;
}

interface JiraMyselfResponse {
  accountId?: unknown;
}

interface JiraDynamicWebhookRegistrationResponse {
  webhookRegistrationResult?: unknown;
}

const JIRA_REFRESH_TOKEN_TERMINAL_ERROR_CODES = new Set(['invalid_grant', 'unauthorized_client']);

export function createJiraApiClient(): JiraApiClient {
  const deleteDynamicWebhooks: JiraApiClient['deleteDynamicWebhooks'] = async (input) => {
    await mapJiraError('delete-dynamic-webhooks', () =>
      ky.delete(`${config.JIRA_API_BASE_URL}/ex/jira/${input.cloudId}/rest/api/3/webhook`, {
        headers: {authorization: `Bearer ${input.accessToken}`},
        json: {webhookIds: input.webhookIds},
        timeout: JIRA_API_TIMEOUT_MS,
      }),
    );
  };

  return {
    async exchangeAuthorizationCode(input) {
      const body = await mapJiraError('exchange-authorization-code', () =>
        ky
          .post(`${config.JIRA_AUTH_BASE_URL}/oauth/token`, {
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              client_id: config.JIRA_OAUTH_CLIENT_ID,
              client_secret: config.JIRA_OAUTH_CLIENT_SECRET,
              code: input.code,
              redirect_uri: config.JIRA_OAUTH_REDIRECT_URL,
            }),
            timeout: JIRA_API_TIMEOUT_MS,
          })
          .json<JiraTokenResponse>(),
      );
      return parseAuthorization(body);
    },

    async refreshAccessToken(input) {
      const body = await mapJiraError('refresh-access-token', () =>
        ky
          .post(`${config.JIRA_AUTH_BASE_URL}/oauth/token`, {
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              client_id: config.JIRA_OAUTH_CLIENT_ID,
              client_secret: config.JIRA_OAUTH_CLIENT_SECRET,
              refresh_token: input.refreshToken,
            }),
            timeout: JIRA_API_TIMEOUT_MS,
          })
          .json<JiraTokenResponse>(),
      );
      return parseAuthorization(body);
    },

    async getAccessibleResources(input) {
      const body = await mapJiraError('get-accessible-resources', () =>
        ky
          .get(`${config.JIRA_API_BASE_URL}/oauth/token/accessible-resources`, {
            headers: {authorization: `Bearer ${input.accessToken}`},
            timeout: JIRA_API_TIMEOUT_MS,
          })
          .json<unknown>(),
      );
      if (!Array.isArray(body)) {
        throw malformed('Jira accessible-resources response was not an array');
      }
      return body.map(parseAccessibleResource);
    },

    async getMyself(input) {
      const body = await mapJiraError('get-myself', () =>
        ky
          .get(`${config.JIRA_API_BASE_URL}/ex/jira/${input.cloudId}/rest/api/3/myself`, {
            headers: {authorization: `Bearer ${input.accessToken}`},
            timeout: JIRA_API_TIMEOUT_MS,
          })
          .json<JiraMyselfResponse>(),
      );
      if (typeof body.accountId !== 'string' || body.accountId.length === 0) {
        throw malformed('Jira identity response did not include an accountId');
      }
      return {accountId: body.accountId};
    },

    async registerDynamicWebhook(input) {
      const body = await mapJiraError('register-dynamic-webhook', () =>
        ky
          .post(`${config.JIRA_API_BASE_URL}/ex/jira/${input.cloudId}/rest/api/3/webhook`, {
            headers: {authorization: `Bearer ${input.accessToken}`},
            json: {
              url: input.url,
              webhooks: [
                {
                  events: JIRA_DYNAMIC_WEBHOOK_EVENTS,
                  jqlFilter: JIRA_DYNAMIC_WEBHOOK_JQL,
                },
              ],
            },
            timeout: JIRA_API_TIMEOUT_MS,
          })
          .json<JiraDynamicWebhookRegistrationResponse>(),
      );
      return parseDynamicWebhookRegistration(body);
    },

    async refreshDynamicWebhooks(input) {
      const response = await mapJiraError('refresh-dynamic-webhooks', async () => {
        try {
          return await ky.put(
            `${config.JIRA_API_BASE_URL}/ex/jira/${input.cloudId}/rest/api/3/webhook/refresh`,
            {
              headers: {authorization: `Bearer ${input.accessToken}`},
              json: {webhookIds: input.webhookIds},
              timeout: JIRA_API_TIMEOUT_MS,
            },
          );
        } catch (error) {
          if (
            error instanceof HTTPError &&
            (error.response.status === 400 || error.response.status === 404)
          )
            return undefined;
          throw error;
        }
      });
      if (!response) return undefined;
      return parseDynamicWebhookExpiration(await readJiraResponseBody(response));
    },

    deleteDynamicWebhooks,

    async deleteDynamicWebhook(input) {
      await deleteDynamicWebhooks({
        accessToken: input.accessToken,
        cloudId: input.cloudId,
        webhookIds: [input.webhookId],
      });
    },
  };
}

export function createJiraAgentToolsClient(): JiraAgentToolsClient {
  return {request: requestJiraRest};
}

async function requestJiraRest(input: JiraAgentToolRequest): Promise<JiraAgentToolResponse> {
  return await mapJiraError(input.operation ?? 'agent-tool', async () => {
    try {
      const response = await ky(jiraRestUrl(input.cloudId, input.path), {
        method: input.method,
        headers: {authorization: `Bearer ${input.accessToken}`},
        ...(input.query === undefined ? {} : {searchParams: jiraQueryParams(input.query)}),
        ...(input.body === undefined ? {} : {json: input.body}),
        timeout: JIRA_API_TIMEOUT_MS,
      });
      return {status: response.status, body: await readJiraResponseBody(response)};
    } catch (error) {
      if (
        error instanceof HTTPError &&
        (error.response.status === 400 || error.response.status === 404)
      ) {
        return {
          status: error.response.status,
          body: await readJiraResponseBody(error.response),
        };
      }
      throw error;
    }
  });
}

function jiraRestUrl(cloudId: string, path: string): string {
  const baseUrl = config.JIRA_API_BASE_URL.replace(TRAILING_SLASHES_RE, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3${normalizedPath}`;
}

function jiraQueryParams(
  query: Record<string, JiraAgentToolQueryValue>,
): URLSearchParams | undefined {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
      continue;
    }
    params.set(key, String(value));
  }
  return params.size > 0 ? params : undefined;
}

async function readJiraResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseDynamicWebhookRegistration(
  body: JiraDynamicWebhookRegistrationResponse,
): JiraDynamicWebhookRegistration {
  if (
    !body ||
    typeof body !== 'object' ||
    !Array.isArray(body.webhookRegistrationResult) ||
    body.webhookRegistrationResult.length !== 1
  ) {
    throw malformed('Jira webhook registration response did not contain exactly one result');
  }

  const result = body.webhookRegistrationResult[0];
  if (!result || typeof result !== 'object') {
    throw malformed('Jira webhook registration result was malformed');
  }
  const {createdWebhookId, errors} = result as {
    createdWebhookId?: unknown;
    errors?: unknown;
  };
  if (errors !== undefined && !Array.isArray(errors)) {
    throw malformed('Jira webhook registration returned errors');
  }
  if (Array.isArray(errors) && errors.length > 0) {
    logger().warn(
      {
        operation: 'register-dynamic-webhook',
        providerErrors: errors
          .filter((error): error is string => typeof error === 'string')
          .slice(0, 5)
          .map((error) => error.slice(0, 500)),
        providerErrorCount: errors.length,
      },
      'Jira dynamic webhook registration rejected',
    );
    throw malformed('Jira webhook registration returned errors');
  }
  if (
    typeof createdWebhookId !== 'number' ||
    !Number.isSafeInteger(createdWebhookId) ||
    createdWebhookId <= 0
  ) {
    throw malformed('Jira webhook registration did not return a created webhook id');
  }
  return {webhookId: createdWebhookId};
}

function parseDynamicWebhookExpiration(body: unknown): Date | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw malformed('Jira webhook refresh response was malformed');
  }
  const expirationDate = (body as {expirationDate?: unknown}).expirationDate;
  if (expirationDate === undefined) return undefined;
  if (typeof expirationDate !== 'string') {
    throw malformed('Jira webhook refresh response included a malformed expiration date');
  }
  const parsed = new Date(expirationDate);
  if (Number.isNaN(parsed.getTime())) {
    throw malformed('Jira webhook refresh response included a malformed expiration date');
  }
  return parsed;
}

function parseAuthorization(body: JiraTokenResponse): JiraAuthorization {
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw malformed('Jira authorization response did not include an access token');
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
    expiresAt: parseExpiresAt(body.expires_in),
    scopes: parseScopes(body.scope),
  };
}

function parseAccessibleResource(value: unknown): JiraAccessibleResource {
  if (!value || typeof value !== 'object') throw malformed('Jira site response was malformed');
  const {id, name, url, scopes} = value as JiraResourceResponse;
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    typeof name !== 'string' ||
    name.length === 0 ||
    typeof url !== 'string' ||
    url.length === 0 ||
    !Array.isArray(scopes) ||
    !scopes.every((scope) => typeof scope === 'string')
  ) {
    throw malformed('Jira site response did not include a valid cloud id, name, URL, and scopes');
  }
  return {cloudId: id, name, url, scopes};
}

function parseScopes(scope: unknown): string[] {
  if (typeof scope === 'string')
    return scope
      .split(SCOPE_SEPARATOR_RE)
      .map((value) => value.trim())
      .filter(Boolean);
  if (Array.isArray(scope) && scope.every((value) => typeof value === 'string')) return scope;
  if (scope === undefined) return [];
  throw malformed('Jira authorization response included malformed scopes');
}

function parseExpiresAt(expiresIn: unknown): Date | undefined {
  if (expiresIn === undefined) return undefined;
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw malformed('Jira authorization response included a malformed expiry');
  }
  return new Date(Date.now() + expiresIn * 1000);
}

export async function mapJiraError<T>(operation: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof JiraIntegrationProviderError) throw error;
    throw mapUnknownJiraError(operation, error);
  }
}

function mapUnknownJiraError(operation: string, error: unknown): JiraIntegrationProviderError {
  if (error instanceof HTTPError) return mapJiraHttpError(operation, error);
  if (error instanceof TimeoutError) {
    logger().warn({operation}, 'Jira API request timed out');
    return new JiraIntegrationProviderError('timeout', 'Jira request timed out');
  }
  logger().warn(
    {operation, errName: error instanceof Error ? error.name : typeof error},
    'Jira API request failed',
  );
  return new JiraIntegrationProviderError('provider-unavailable', 'Jira request failed');
}

function mapJiraHttpError(operation: string, error: HTTPError): JiraIntegrationProviderError {
  const {status, statusText, headers} = error.response;
  logger().warn({operation, status, statusText}, 'Jira API request rejected');
  if (status === 429) {
    return new JiraIntegrationProviderError(
      'rate-limited',
      'Jira request was rate limited',
      retryAfterSeconds(headers),
    );
  }
  if (status >= 500)
    return new JiraIntegrationProviderError('provider-unavailable', 'Jira request failed');
  if (status === 401 || status === 403) {
    return new JiraIntegrationProviderError('access-denied', 'Jira request was rejected');
  }
  if (isTerminalRefreshRejection(operation, status, error.data)) {
    return new JiraIntegrationProviderError(
      'access-denied',
      'Jira refresh token was rejected; reconnect is required',
    );
  }
  return malformed('Jira request was rejected');
}

function isTerminalRefreshRejection(operation: string, status: number, data: unknown): boolean {
  if (status !== 400 || operation !== 'refresh-access-token') return false;
  const errorCode = readJiraOAuthErrorCode(data);
  return errorCode !== undefined && JIRA_REFRESH_TOKEN_TERMINAL_ERROR_CODES.has(errorCode);
}

function malformed(message: string): JiraIntegrationProviderError {
  return new JiraIntegrationProviderError('malformed-provider-response', message);
}

function readJiraOAuthErrorCode(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const errorCode = (data as {error?: unknown}).error;
  return typeof errorCode === 'string' ? errorCode : undefined;
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
