import {
  AUTH_USER,
  buildUserContext,
  getUserContext,
  setUserContext,
  type UserContext,
} from '@shipfox/api-auth-context';
import {userAccessTokenKey} from '@shipfox/node-auth-root-key';
import {type AuthMethod, ClientError} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import type {RefreshToken} from '#core/entities/refresh-token.js';
import type {User} from '#core/entities/user.js';
import type {UserTokenClaims} from '#core/jwt.js';
import {verifyUserToken} from '#core/jwt.js';
import {findActiveRefreshSession} from '#db/refresh-tokens.js';
import {findUserById} from '#db/users.js';
import {createBearerTokenAuthMethod} from './bearer-token-auth.js';

const AUTHENTICATED_SESSION_CONTEXT_KEY = Symbol.for('@shipfox/api-auth/session');

export type ClientContext = UserContext;

export type UserId = User['id'];
export type RefreshSessionId = RefreshToken['sessionId'];

export type AuthenticatedSessionContext = {
  userId: UserId;
  refreshSessionId: RefreshSessionId;
};

export interface CreateJwtAuthMethodOptions {
  secret: string;
}

class InvalidJwtTokenError extends Error {
  constructor() {
    super('Invalid JWT');
    this.name = 'InvalidJwtTokenError';
  }
}

export function getClientContext(request: FastifyRequest): ClientContext | null {
  return getUserContext(request);
}

function setAuthenticatedSessionContext(request: FastifyRequest, claims: UserTokenClaims): void {
  (request as unknown as Record<symbol, unknown>)[AUTHENTICATED_SESSION_CONTEXT_KEY] = {
    userId: claims.sub,
    refreshSessionId: claims.refreshSessionId,
  };
}

function getAuthenticatedSessionTokenContext(request: FastifyRequest): {
  userId: UserId;
  refreshSessionId: RefreshSessionId | undefined;
} | null {
  return (
    ((request as unknown as Record<symbol, unknown>)[AUTHENTICATED_SESSION_CONTEXT_KEY] as
      | {userId: UserId; refreshSessionId: RefreshSessionId | undefined}
      | undefined) ?? null
  );
}

/**
 * Resolves the active refresh session backing an authenticated user request.
 * The session check intentionally happens only for consumers that need browser-session binding.
 */
export async function getAuthenticatedSessionContext(
  request: FastifyRequest,
): Promise<AuthenticatedSessionContext> {
  const client = getClientContext(request);
  const token = getAuthenticatedSessionTokenContext(request);
  if (!client || !token || token.userId !== client.userId || !token.refreshSessionId)
    throw new ClientError('Invalid or expired token', 'unauthorized', {status: 401});

  const session = await findActiveRefreshSession({
    sessionId: token.refreshSessionId,
    userId: client.userId,
  });
  if (!session) throw new ClientError('Invalid or expired token', 'unauthorized', {status: 401});

  return {userId: client.userId, refreshSessionId: session.sessionId};
}

export function createJwtAuthMethod(): AuthMethod {
  return createBearerTokenAuthMethod({
    name: AUTH_USER,
    verifyToken: async (token) => {
      let claims: UserTokenClaims;
      try {
        claims = await verifyUserToken({token, secret: userAccessTokenKey()});
      } catch {
        throw new InvalidJwtTokenError();
      }
      const user = await findUserById({id: claims.sub});

      // Legacy access tokens without a session claim remain verifiable for the
      // migration window; known suspended or deleted users are still rejected.
      if (user && user.status !== 'active') return null;
      if (!claims.refreshSessionId) return claims;
      if (!user) return null;

      const session = await findActiveRefreshSession({
        sessionId: claims.refreshSessionId,
        userId: claims.sub,
      });
      return session ? claims : null;
    },
    isInvalidTokenError: (error) => error instanceof InvalidJwtTokenError,
    invalidTokenError: {message: 'Invalid or expired token', code: 'unauthorized'},
    setContext: (request, claims) => {
      const clientContext: ClientContext = buildUserContext({
        userId: claims.sub,
        email: claims.email,
        name: claims.name ?? null,
        memberships: claims.memberships,
      });
      setUserContext(request, clientContext);
      setAuthenticatedSessionContext(request, claims);
    },
  });
}
