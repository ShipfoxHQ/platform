import {timingSafeEqual} from 'node:crypto';
import {
  type AuthMethod,
  ClientError,
  type RouteExport,
  type RouteGroup,
} from '@shipfox/node-fastify';

export const AUTH_E2E_ADMIN = 'e2e-admin';

export interface E2eConfig {
  E2E_ENABLED: boolean;
  E2E_ADMIN_API_KEY?: string | undefined;
}

const BEARER_RE = /^Bearer /u;

export function shouldMountE2eRoutes(config: E2eConfig): boolean {
  return config.E2E_ENABLED && Boolean(config.E2E_ADMIN_API_KEY);
}

function extractBearerToken(header: string | undefined): string | undefined {
  return header?.replace(BEARER_RE, '');
}

function tokensMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function createE2eAdminAuthMethod(config: E2eConfig): AuthMethod {
  return {
    name: AUTH_E2E_ADMIN,
    authenticate: async (request) => {
      await Promise.resolve();
      const expected = config.E2E_ADMIN_API_KEY;
      const actual = extractBearerToken(request.headers.authorization);

      if (!expected || !actual || !tokensMatch(actual, expected)) {
        throw new ClientError('Missing or invalid E2E admin API key', 'unauthorized', {
          status: 401,
        });
      }
    },
  };
}

export function createE2eRouteGroup(routes: RouteExport[], config: E2eConfig): RouteGroup[] {
  if (!shouldMountE2eRoutes(config) || routes.length === 0) return [];

  return [
    {
      prefix: '/__e2e',
      auth: AUTH_E2E_ADMIN,
      routes,
    },
  ];
}
