import {type AuthMethod, ClientError, extractBearerToken} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';

interface UnauthorizedErrorParams {
  message: string;
  code: string;
}

interface BearerTokenAuthMethodOptions<TClaims> {
  name: string;
  verifyToken: (token: string) => Promise<TClaims | null>;
  isInvalidTokenError?: (error: unknown) => boolean;
  invalidTokenError: UnauthorizedErrorParams;
  setContext: (request: FastifyRequest, claims: TClaims) => void;
}

const missingBearerError: UnauthorizedErrorParams = {
  message: 'Missing or invalid Authorization header',
  code: 'unauthorized',
};

export function createBearerTokenAuthMethod<TClaims>(
  options: BearerTokenAuthMethodOptions<TClaims>,
): AuthMethod {
  return {
    name: options.name,
    authenticate: async (request) => {
      const token = extractBearerToken(request.headers.authorization);
      if (!token) throwUnauthorized(missingBearerError);

      const claims = await verifyBearerToken(
        token,
        options.verifyToken,
        options.isInvalidTokenError,
      );
      if (!claims) throwUnauthorized(options.invalidTokenError);

      options.setContext(request, claims);
    },
  };
}

async function verifyBearerToken<TClaims>(
  token: string,
  verifyToken: (token: string) => Promise<TClaims | null>,
  isInvalidTokenError: ((error: unknown) => boolean) | undefined,
): Promise<TClaims | null> {
  try {
    return await verifyToken(token);
  } catch (error) {
    if (isInvalidTokenError && !isInvalidTokenError(error)) throw error;
    return null;
  }
}

function throwUnauthorized(error: UnauthorizedErrorParams): never {
  throw new ClientError(error.message, error.code, {status: 401});
}
