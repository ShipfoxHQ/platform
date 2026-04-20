import {
  AUTH_USER,
  getUserContext,
  setUserContext,
  type UserContext,
} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {config} from '#config.js';
import {verifyUserToken} from '#core/jwt.js';

export type ClientContext = UserContext;

export interface CreateJwtAuthMethodOptions {
  secret: string;
}

function extractBearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') return undefined;
  return parts[1];
}

export function getClientContext(request: FastifyRequest): ClientContext | null {
  return getUserContext(request);
}

export function createJwtAuthMethod(): AuthMethod {
  return {
    name: AUTH_USER,
    authenticate: async (request) => {
      const token = extractBearerToken(request.headers.authorization);
      if (!token) {
        throw new ClientError('Missing or invalid Authorization header', 'unauthorized', {
          status: 401,
        });
      }

      const claims = await verifyUserToken({token, secret: config.AUTH_JWT_SECRET}).catch(() => {
        throw new ClientError('Invalid or expired token', 'unauthorized', {status: 401});
      });

      const clientContext: ClientContext = {
        userId: claims.sub,
        email: claims.email,
      };

      setUserContext(request, clientContext);
    },
  };
}
