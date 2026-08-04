import {jiraWebhookEventNames} from '@shipfox/api-integration-jira-dto';
import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError, TimeoutError} from 'ky';
import {config} from '#config.js';
import {JiraIntegrationProviderError} from '#core/errors.js';

const JIRA_API_TIMEOUT_MS = 10_000;
const SCOPE_SEPARATOR_RE = /[,\s]+/;
export const JIRA_DYNAMIC_WEBHOOK_EVENTS = jiraWebhookEventNames;
export const JIRA_DYNAMIC_WEBHOOK_JQL = '';

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

export function createJiraApiClient(): JiraApiClient {
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

    async deleteDynamicWebhook(input) {
      await mapJiraError('delete-dynamic-webhook', () =>
        ky.delete(`${config.JIRA_API_BASE_URL}/ex/jira/${input.cloudId}/rest/api/3/webhook`, {
          headers: {authorization: `Bearer ${input.accessToken}`},
          json: {webhookIds: [input.webhookId]},
          timeout: JIRA_API_TIMEOUT_MS,
        }),
      );
    },
  };
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
  if (errors !== undefined && (!Array.isArray(errors) || errors.length > 0)) {
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
    if (error instanceof HTTPError) {
      const {status, statusText, headers} = error.response;
      logger().warn({operation, status, statusText}, 'Jira API request rejected');
      if (status === 429) {
        throw new JiraIntegrationProviderError(
          'rate-limited',
          'Jira request was rate limited',
          retryAfterSeconds(headers),
        );
      }
      if (status >= 500)
        throw new JiraIntegrationProviderError('provider-unavailable', 'Jira request failed');
      if (status === 401 || status === 403) {
        throw new JiraIntegrationProviderError('access-denied', 'Jira request was rejected');
      }
      if (status === 400 && operation === 'refresh-access-token') {
        throw new JiraIntegrationProviderError(
          'access-denied',
          'Jira refresh token was rejected; reconnect is required',
        );
      }
      throw malformed('Jira request was rejected');
    }
    if (error instanceof TimeoutError) {
      logger().warn({operation}, 'Jira API request timed out');
      throw new JiraIntegrationProviderError('timeout', 'Jira request timed out');
    }
    logger().warn(
      {operation, errName: error instanceof Error ? error.name : typeof error},
      'Jira API request failed',
    );
    throw new JiraIntegrationProviderError('provider-unavailable', 'Jira request failed');
  }
}

function malformed(message: string): JiraIntegrationProviderError {
  return new JiraIntegrationProviderError('malformed-provider-response', message);
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
