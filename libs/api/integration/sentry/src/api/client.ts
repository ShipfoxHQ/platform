import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError, TimeoutError} from 'ky';
import {config} from '#config.js';
import {SentryIntegrationProviderError} from '#core/errors.js';

const SENTRY_API_BASE = 'https://sentry.io/api/0';

export interface SentryAuthorization {
  token: string;
  refreshToken: string;
  expiresAt: string;
}

export interface SentryInstallationDetails {
  orgSlug: string;
}

export interface SentryApiClient {
  exchangeAuthorizationCode(input: {
    installationUuid: string;
    code: string;
  }): Promise<SentryAuthorization>;
  // Derived from Sentry so the org slug is never trusted from the client body.
  getInstallation(input: {
    installationUuid: string;
    token: string;
  }): Promise<SentryInstallationDetails>;
  verifyInstallation(input: {installationUuid: string; token: string}): Promise<void>;
}

export function createSentryApiClient(): SentryApiClient {
  return {
    async exchangeAuthorizationCode(input) {
      // Encode the uuid: it originates from the request body / webhook payload, so
      // a path separator in it must not be able to alter the request path (the host
      // is already pinned to SENTRY_API_BASE).
      const body = await mapSentryError('exchange-authorization-code', () =>
        ky
          .post(
            `${SENTRY_API_BASE}/sentry-app-installations/${encodeURIComponent(input.installationUuid)}/authorizations/`,
            {
              json: {
                grant_type: 'authorization_code',
                client_id: config.SENTRY_APP_CLIENT_ID,
                client_secret: config.SENTRY_APP_CLIENT_SECRET,
                code: input.code,
              },
            },
          )
          .json<{token?: unknown; refreshToken?: unknown; expiresAt?: unknown}>(),
      );

      if (
        typeof body.token !== 'string' ||
        typeof body.refreshToken !== 'string' ||
        typeof body.expiresAt !== 'string'
      ) {
        throw new SentryIntegrationProviderError(
          'malformed-provider-response',
          'Sentry authorization response did not include a token',
        );
      }
      return {token: body.token, refreshToken: body.refreshToken, expiresAt: body.expiresAt};
    },

    async getInstallation(input) {
      const body = await mapSentryError('get-installation', () =>
        ky
          .get(
            `${SENTRY_API_BASE}/sentry-app-installations/${encodeURIComponent(input.installationUuid)}/`,
            {
              headers: {authorization: `Bearer ${input.token}`},
            },
          )
          .json<{organization?: {slug?: unknown}}>(),
      );

      const slug = body.organization?.slug;
      if (typeof slug !== 'string' || slug.length === 0) {
        throw new SentryIntegrationProviderError(
          'malformed-provider-response',
          'Sentry installation response did not include an organization slug',
        );
      }
      return {orgSlug: slug};
    },

    async verifyInstallation(input) {
      await mapSentryError('verify-installation', () =>
        ky
          .put(
            `${SENTRY_API_BASE}/sentry-app-installations/${encodeURIComponent(input.installationUuid)}/`,
            {
              headers: {authorization: `Bearer ${input.token}`},
              json: {status: 'installed'},
            },
          )
          .json<unknown>(),
      );
    },
  };
}

// The typed error deliberately drops Sentry's status and body so no token, code,
// or client secret can leak to the client or the logged error chain. That also
// strips the one detail a self-hoster needs to fix a misconfigured Sentry app.
// e.g. a 403 on `get-installation` means the app is missing "Organization: Read"
// (see README "Required permissions"). So we log the upstream status
// here, the only place it survives, keyed by the operation that failed.
async function mapSentryError<T>(operation: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof SentryIntegrationProviderError) throw error;
    if (error instanceof HTTPError) {
      const {status, statusText, headers} = error.response;
      logger().warn({operation, status, statusText}, 'Sentry API request rejected');
      if (status === 429) {
        throw new SentryIntegrationProviderError(
          'rate-limited',
          'Sentry request was rate limited',
          retryAfterSeconds(headers),
        );
      }
      if (status >= 500) {
        throw new SentryIntegrationProviderError('provider-unavailable', 'Sentry request failed');
      }
      throw new SentryIntegrationProviderError('access-denied', 'Sentry request was rejected');
    }
    if (error instanceof TimeoutError) {
      logger().warn({operation}, 'Sentry API request timed out');
      throw new SentryIntegrationProviderError('timeout', 'Sentry request timed out');
    }
    logger().warn(
      {operation, errName: error instanceof Error ? error.name : typeof error},
      'Sentry API request failed',
    );
    throw new SentryIntegrationProviderError('provider-unavailable', 'Sentry request failed');
  }
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return undefined;
  const parsed = Number.parseInt(retryAfter, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
