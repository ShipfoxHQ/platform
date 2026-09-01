import {
  type AgentAccessContext,
  type AgentAccessScope,
  AUTH_AGENT_ACCESS,
  setAgentAccessContext,
} from '@shipfox/api-auth-context';
import type {AgentAccessTokenClaims} from '@shipfox/api-auth-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {type AuthMethod, ClientError, type FastifyRequest} from '@shipfox/node-fastify';
import {getTokenType, hashOpaqueToken} from '@shipfox/node-tokens';
import {requireActiveAgentWorkspaceMembership} from '#core/agent-access.js';
import {verifyAgentAccessToken} from '#core/agent-access-token.js';
import type {AgentPersonalAccessToken} from '#core/entities/agent-access.js';
import {AgentAccessWorkspaceError, AuthDependencyUnavailableError} from '#core/errors.js';
import {
  findActiveAgentPersonalAccessTokenByHash,
  markAgentPersonalAccessTokenUsed,
} from '#db/agent-access.js';
import {createBearerTokenAuthMethod} from './bearer-token-auth.js';

const MAX_PRESENTED_TOKEN_BYTES = 1024;

type VerifiedAgentAccessCredential =
  | {kind: 'oauth'; claims: AgentAccessTokenClaims}
  | {kind: 'pat'; pat: AgentPersonalAccessToken};

class InvalidAgentAccessCredentialError extends Error {
  constructor() {
    super('Invalid agent access credential');
    this.name = 'InvalidAgentAccessCredentialError';
  }
}

function invalidCredential(): never {
  throw new InvalidAgentAccessCredentialError();
}

function dependencyUnavailable(error: unknown): ClientError {
  return new ClientError('Authentication dependency unavailable', 'auth-dependency-unavailable', {
    status: 503,
    cause: error,
  });
}

function agentScopes(scopes: string[]): ReadonlyArray<AgentAccessScope> {
  if (scopes.length === 0 || scopes.some((scope) => scope !== 'read')) invalidCredential();
  return scopes as ReadonlyArray<AgentAccessScope>;
}

async function findActiveAgentPersonalAccessToken(
  token: string,
): Promise<AgentPersonalAccessToken | undefined> {
  try {
    return await findActiveAgentPersonalAccessTokenByHash({hashedToken: hashOpaqueToken(token)});
  } catch (error) {
    throw dependencyUnavailable(error);
  }
}

async function verifyAgentPersonalAccessToken(
  token: string,
  workspaces: WorkspacesInterModuleClient,
): Promise<VerifiedAgentAccessCredential> {
  const pat = await findActiveAgentPersonalAccessToken(token);
  if (!pat) return invalidCredential();
  // Reject malformed persisted authority before touching its last-used timestamp.
  agentScopes(pat.scopes);

  try {
    await requireActiveAgentWorkspaceMembership({
      userId: pat.userId,
      workspaceId: pat.workspaceId,
      workspaces,
    });
  } catch (error) {
    if (error instanceof AgentAccessWorkspaceError) return invalidCredential();
    if (error instanceof AuthDependencyUnavailableError) throw dependencyUnavailable(error);
    throw error;
  }

  let used: AgentPersonalAccessToken | undefined;
  try {
    used = await markAgentPersonalAccessTokenUsed({id: pat.id});
  } catch (error) {
    throw dependencyUnavailable(error);
  }
  if (!used) return invalidCredential();
  return {kind: 'pat', pat: used};
}

async function verifyAgentAccessCredential(
  token: string,
  workspaces: WorkspacesInterModuleClient,
): Promise<VerifiedAgentAccessCredential | null> {
  if (Buffer.byteLength(token, 'utf8') > MAX_PRESENTED_TOKEN_BYTES) return invalidCredential();

  if (getTokenType(token) === 'personalAccessToken') {
    return await verifyAgentPersonalAccessToken(token, workspaces);
  }

  const claims = await verifyAgentAccessToken(token);
  if (!claims) return invalidCredential();
  return {kind: 'oauth', claims};
}

function contextForCredential(credential: VerifiedAgentAccessCredential): AgentAccessContext {
  if (credential.kind === 'oauth') {
    return {
      userId: credential.claims.sub,
      workspaceId: credential.claims.workspaceId,
      scopes: credential.claims.scopes,
      credential: {
        kind: 'oauth_grant',
        grantId: credential.claims.grantId,
        clientId: credential.claims.clientId,
      },
    };
  }

  return {
    userId: credential.pat.userId,
    workspaceId: credential.pat.workspaceId,
    scopes: agentScopes(credential.pat.scopes),
    credential: {kind: 'pat', patId: credential.pat.id},
  };
}

/** Authenticates stateless OAuth access tokens and database-checked PATs. */
export function createAgentAccessAuthMethod(workspaces: WorkspacesInterModuleClient): AuthMethod {
  return createBearerTokenAuthMethod({
    name: AUTH_AGENT_ACCESS,
    verifyToken: (token) => verifyAgentAccessCredential(token, workspaces),
    isInvalidTokenError: (error) => error instanceof InvalidAgentAccessCredentialError,
    invalidTokenError: {message: 'Invalid or expired agent access token', code: 'unauthorized'},
    setContext: (request: FastifyRequest, credential) => {
      setAgentAccessContext(request, contextForCredential(credential));
    },
  });
}
