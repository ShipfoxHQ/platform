import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError, TimeoutError} from 'ky';
import {config} from '#config.js';
import {LinearIntegrationProviderError} from '#core/errors.js';

const LINEAR_OAUTH_TOKEN_URL = 'https://api.linear.app/oauth/token';
const LINEAR_OAUTH_REVOKE_URL = 'https://api.linear.app/oauth/revoke';
const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';
const LINEAR_API_TIMEOUT_MS = 10_000;
const SCOPE_SEPARATOR_RE = /[,\s]+/;

const IDENTITY_QUERY = `
  query ShipfoxLinearIdentity {
    viewer {
      id
    }
    organization {
      id
      name
      urlKey
    }
  }
`;

export interface LinearAuthorization {
  accessToken: string;
  refreshToken?: string | undefined;
  expiresAt?: Date | undefined;
  scopes: string[];
}

export interface LinearIdentity {
  appUserId: string;
  organizationId: string;
  organizationName: string;
  organizationUrlKey: string;
}

export interface LinearApiClient {
  exchangeAuthorizationCode(input: {code: string}): Promise<LinearAuthorization>;
  refreshAccessToken(input: {refreshToken: string}): Promise<LinearAuthorization>;
  revokeToken(input: {
    token: string;
    tokenTypeHint: 'access_token' | 'refresh_token';
  }): Promise<void>;
  getIdentity(input: {accessToken: string}): Promise<LinearIdentity>;
}

interface LinearTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

interface LinearGraphqlResponse<Data> {
  data?: Data | null;
  errors?: LinearGraphqlError[] | undefined;
}

interface LinearGraphqlError {
  extensions?: {type?: unknown} | undefined;
}

interface LinearIdentityData {
  viewer?: {id?: unknown} | null;
  organization?: {id?: unknown; name?: unknown; urlKey?: unknown} | null;
}

interface MapLinearErrorOptions {
  classifyHttp4xx?(status: number): 'access-denied' | 'malformed-provider-response';
}

export function createLinearApiClient(): LinearApiClient {
  return {
    async exchangeAuthorizationCode(input) {
      const body = await mapLinearError('exchange-authorization-code', () =>
        ky
          .post(LINEAR_OAUTH_TOKEN_URL, {
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              client_id: config.LINEAR_OAUTH_CLIENT_ID,
              client_secret: config.LINEAR_OAUTH_CLIENT_SECRET,
              code: input.code,
              redirect_uri: config.LINEAR_OAUTH_REDIRECT_URL,
            }),
            timeout: LINEAR_API_TIMEOUT_MS,
          })
          .json<LinearTokenResponse>(),
      );

      return parseTokenResponse(body);
    },

    async refreshAccessToken(input) {
      const body = await mapLinearError('refresh-access-token', () =>
        ky
          .post(LINEAR_OAUTH_TOKEN_URL, {
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              client_id: config.LINEAR_OAUTH_CLIENT_ID,
              client_secret: config.LINEAR_OAUTH_CLIENT_SECRET,
              refresh_token: input.refreshToken,
            }),
            timeout: LINEAR_API_TIMEOUT_MS,
          })
          .json<LinearTokenResponse>(),
      );

      return parseTokenResponse(body);
    },

    async revokeToken(input) {
      await mapLinearError('revoke-token', async () => {
        await ky.post(LINEAR_OAUTH_REVOKE_URL, {
          body: new URLSearchParams({
            client_id: config.LINEAR_OAUTH_CLIENT_ID,
            client_secret: config.LINEAR_OAUTH_CLIENT_SECRET,
            token: input.token,
            token_type_hint: input.tokenTypeHint,
          }),
          timeout: LINEAR_API_TIMEOUT_MS,
        });
      });
    },

    async getIdentity(input) {
      const body = await mapLinearError(
        'get-identity',
        () =>
          ky
            .post(LINEAR_GRAPHQL_URL, {
              headers: {authorization: `Bearer ${input.accessToken}`},
              json: {query: IDENTITY_QUERY},
              timeout: LINEAR_API_TIMEOUT_MS,
            })
            .json<LinearGraphqlResponse<LinearIdentityData>>(),
        {classifyHttp4xx: classifyGraphqlHttp4xx},
      );
      const data = graphqlData('get-identity', body);
      const appUserId = data.viewer?.id;
      const organizationId = data.organization?.id;
      const organizationName = data.organization?.name;
      const organizationUrlKey = data.organization?.urlKey;

      if (
        typeof appUserId !== 'string' ||
        typeof organizationId !== 'string' ||
        typeof organizationName !== 'string' ||
        typeof organizationUrlKey !== 'string'
      ) {
        throw new LinearIntegrationProviderError(
          'malformed-provider-response',
          'Linear identity response did not include the app user and organization',
        );
      }

      return {appUserId, organizationId, organizationName, organizationUrlKey};
    },
  };
}

function parseTokenResponse(body: LinearTokenResponse): LinearAuthorization {
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw new LinearIntegrationProviderError(
      'malformed-provider-response',
      'Linear authorization response did not include an access token',
    );
  }

  const scopes = parseScopes(body.scope);
  const expiresAt = parseExpiresAt(body.expires_in);
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : undefined;
  return {accessToken: body.access_token, refreshToken, expiresAt, scopes};
}

function parseScopes(scope: unknown): string[] {
  if (typeof scope === 'string') {
    return scope
      .split(SCOPE_SEPARATOR_RE)
      .map((value) => value.trim())
      .filter(Boolean);
  }
  if (Array.isArray(scope) && scope.every((value) => typeof value === 'string')) return scope;
  if (scope === undefined) return [];
  throw new LinearIntegrationProviderError(
    'malformed-provider-response',
    'Linear authorization response included malformed scopes',
  );
}

function parseExpiresAt(expiresIn: unknown): Date | undefined {
  if (expiresIn === undefined) return undefined;
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new LinearIntegrationProviderError(
      'malformed-provider-response',
      'Linear authorization response included a malformed expiry',
    );
  }
  return new Date(Date.now() + expiresIn * 1000);
}

function graphqlData<Data>(operation: string, body: LinearGraphqlResponse<Data>): Data {
  if (hasGraphqlErrors(body)) {
    const reason = hasAuthGraphqlError(body.errors)
      ? 'access-denied'
      : 'malformed-provider-response';
    logger().warn({operation}, 'Linear GraphQL request returned errors');
    throw new LinearIntegrationProviderError(reason, 'Linear GraphQL request failed');
  }
  if (!body.data) {
    throw new LinearIntegrationProviderError(
      'malformed-provider-response',
      'Linear GraphQL response did not include data',
    );
  }
  return body.data;
}

function hasGraphqlErrors(body: LinearGraphqlResponse<unknown>): boolean {
  return Array.isArray(body.errors) && body.errors.length > 0;
}

function hasAuthGraphqlError(errors: LinearGraphqlError[] | undefined): boolean {
  return (
    errors?.some((error) => {
      const type = error.extensions?.type;
      return (
        typeof type === 'string' && ['authentication', 'authorization'].includes(type.toLowerCase())
      );
    }) ?? false
  );
}

async function mapLinearError<T>(
  operation: string,
  request: () => Promise<T>,
  options: MapLinearErrorOptions = {},
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof LinearIntegrationProviderError) throw error;
    throw mapUnknownLinearError(operation, error, options);
  }
}

function mapUnknownLinearError(
  operation: string,
  error: unknown,
  options: MapLinearErrorOptions,
): LinearIntegrationProviderError {
  if (error instanceof HTTPError) return mapLinearHttpError(operation, error, options);
  if (error instanceof TimeoutError) {
    logger().warn({operation}, 'Linear API request timed out');
    return new LinearIntegrationProviderError('timeout', 'Linear request timed out');
  }
  logger().warn(
    {operation, errName: error instanceof Error ? error.name : typeof error},
    'Linear API request failed',
  );
  return new LinearIntegrationProviderError('provider-unavailable', 'Linear request failed');
}

function mapLinearHttpError(
  operation: string,
  error: HTTPError,
  options: MapLinearErrorOptions,
): LinearIntegrationProviderError {
  const {status, statusText, headers} = error.response;
  logger().warn({operation, status, statusText}, 'Linear API request rejected');
  if (status === 429) {
    return new LinearIntegrationProviderError(
      'rate-limited',
      'Linear request was rate limited',
      retryAfterSeconds(headers),
    );
  }
  if (status >= 500) {
    return new LinearIntegrationProviderError('provider-unavailable', 'Linear request failed');
  }
  const reason = options.classifyHttp4xx?.(status) ?? 'access-denied';
  return new LinearIntegrationProviderError(reason, 'Linear request was rejected');
}

function classifyGraphqlHttp4xx(status: number): 'access-denied' | 'malformed-provider-response' {
  return status === 401 || status === 403 ? 'access-denied' : 'malformed-provider-response';
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return undefined;
  const parsed = Number.parseInt(retryAfter, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
