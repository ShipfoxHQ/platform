import {AUTH_AGENT_ACCESS, setAgentAccessContext} from '@shipfox/api-auth-context';
import type {AgentAccessTokenClaims} from '@shipfox/api-auth-dto';
import type {AuthMethod, FastifyRequest} from '@shipfox/node-fastify';
import {verifyAgentAccessToken} from '#core/agent-access-token.js';
import {createBearerTokenAuthMethod} from './bearer-token-auth.js';

// The OAuth claims contract permits a 2 KiB client ID. Keep enough room for
// its base64url-encoded JWT payload, header, and signature.
const MAX_PRESENTED_TOKEN_BYTES = 8 * 1024;

class InvalidAgentAccessCredentialError extends Error {
  constructor() {
    super('Invalid agent access credential');
    this.name = 'InvalidAgentAccessCredentialError';
  }
}

function invalidCredential(): never {
  throw new InvalidAgentAccessCredentialError();
}

async function verifyAgentAccessCredential(token: string): Promise<AgentAccessTokenClaims> {
  if (Buffer.byteLength(token, 'utf8') > MAX_PRESENTED_TOKEN_BYTES) return invalidCredential();

  const claims = await verifyAgentAccessToken(token);
  return claims ?? invalidCredential();
}

/** Authenticates stateless OAuth access tokens. */
export function createAgentAccessAuthMethod(): AuthMethod {
  return createBearerTokenAuthMethod({
    name: AUTH_AGENT_ACCESS,
    verifyToken: verifyAgentAccessCredential,
    isInvalidTokenError: (error) => error instanceof InvalidAgentAccessCredentialError,
    invalidTokenError: {message: 'Invalid or expired agent access token', code: 'unauthorized'},
    setContext: (request: FastifyRequest, claims) => {
      setAgentAccessContext(request, {
        userId: claims.sub,
        workspaceId: claims.workspaceId,
        scopes: claims.scopes,
        credential: {
          kind: 'oauth_grant',
          grantId: claims.grantId,
          clientId: claims.clientId,
        },
      });
    },
  });
}
