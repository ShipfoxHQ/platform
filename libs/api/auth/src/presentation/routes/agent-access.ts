import {AUTH_USER, getUserContext} from '@shipfox/api-auth-context';
import {
  agentAccessCredentialParamsSchema,
  listAgentGrantsResponseSchema,
} from '@shipfox/api-auth-dto';
import {
  ClientError,
  defineRoute,
  type FastifyRequest,
  type RouteGroup,
} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listAgentGrants, revokeAgentGrant} from '#core/agent-access.js';
import {AgentGrantNotFoundError, InvalidAgentAccessScopeError} from '#core/errors.js';

function requireActorId(request: FastifyRequest): string {
  const context = getUserContext(request);
  if (!context) {
    throw new ClientError('Authentication required', 'unauthorized', {status: 401});
  }
  return context.userId;
}

function toReadScopes(scopes: string[]): 'read'[] {
  if (scopes.length === 0 || scopes.some((scope) => scope !== 'read')) {
    throw new InvalidAgentAccessScopeError();
  }
  return scopes as 'read'[];
}

function toAgentGrantSummaryDto(grant: {
  id: string;
  clientName: string;
  workspaceId: string;
  scopes: string[];
  createdAt: Date;
  lastRefreshedAt: Date | null;
}) {
  return {
    id: grant.id,
    client_name: grant.clientName,
    workspace_id: grant.workspaceId,
    scopes: toReadScopes(grant.scopes),
    created_at: grant.createdAt.toISOString(),
    last_refreshed_at: grant.lastRefreshedAt?.toISOString() ?? null,
  };
}

function translateAgentAccessError(error: unknown): never {
  if (error instanceof AgentGrantNotFoundError) {
    throw new ClientError('Agent grant not found', 'not-found', {status: 404});
  }
  if (error instanceof InvalidAgentAccessScopeError) {
    throw new ClientError('Agent access data is invalid', 'server-error', {
      status: 500,
      cause: error,
    });
  }
  throw error;
}

const listGrantsRoute = defineRoute({
  method: 'GET',
  path: '/grants',
  description: "List the signed-in user's active OAuth app grants.",
  schema: {response: {200: listAgentGrantsResponseSchema}},
  errorHandler: translateAgentAccessError,
  handler: async (request) => ({
    grants: (await listAgentGrants({userId: requireActorId(request)})).map(toAgentGrantSummaryDto),
  }),
});

const revokeGrantRoute = defineRoute({
  method: 'DELETE',
  path: '/grants/:id',
  description: "Revoke one of the signed-in user's OAuth app grants.",
  schema: {
    params: agentAccessCredentialParamsSchema,
    response: {204: z.void()},
  },
  errorHandler: translateAgentAccessError,
  handler: async (request, reply) => {
    await revokeAgentGrant({userId: requireActorId(request), grantId: request.params.id});
    reply.code(204);
  },
});

/** Dashboard-facing route group for OAuth grant listing and revocation. */
export function createAgentGrantRoutes(): RouteGroup {
  return {
    prefix: '/agent-access',
    auth: AUTH_USER,
    routes: [listGrantsRoute, revokeGrantRoute],
  };
}

export const createAgentAccessManagementRoutes = createAgentGrantRoutes;
export const createAgentAccessRoutes = createAgentGrantRoutes;
