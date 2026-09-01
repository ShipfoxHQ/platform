import {AUTH_USER, getUserContext, rejectImpersonatedSession} from '@shipfox/api-auth-context';
import {
  agentAccessCredentialParamsSchema,
  createAgentPersonalAccessTokenBodySchema,
  createAgentPersonalAccessTokenResponseSchema,
  listAgentGrantsResponseSchema,
  listAgentPersonalAccessTokensResponseSchema,
} from '@shipfox/api-auth-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {
  ClientError,
  defineRoute,
  type FastifyRequest,
  type RouteGroup,
} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  createAgentPersonalAccessToken,
  listAgentGrants,
  listAgentPersonalAccessTokens,
  revokeAgentGrant,
  revokeAgentPersonalAccessToken,
} from '#core/agent-access.js';
import type {AgentPersonalAccessToken} from '#core/entities/agent-access.js';
import {
  AgentAccessUserInactiveError,
  AgentAccessWorkspaceError,
  AgentGrantNotFoundError,
  AgentPersonalAccessTokenNotFoundError,
  AuthDependencyUnavailableError,
} from '#core/errors.js';

export interface CreateAgentAccessManagementRoutesOptions {
  workspaces: WorkspacesInterModuleClient;
}

function requireActorId(request: FastifyRequest): string {
  const context = getUserContext(request);
  if (!context) {
    throw new ClientError('Authentication required', 'unauthorized', {status: 401});
  }
  return context.userId;
}

function toReadScopes(scopes: string[]): 'read'[] {
  if (scopes.some((scope) => scope !== 'read')) {
    throw new Error('Agent access contains an unsupported scope');
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

function toAgentPersonalAccessTokenSummaryDto(
  pat: Pick<
    AgentPersonalAccessToken,
    'id' | 'workspaceId' | 'prefix' | 'name' | 'expiresAt' | 'lastUsedAt' | 'createdAt'
  >,
) {
  return {
    id: pat.id,
    workspace_id: pat.workspaceId,
    prefix: pat.prefix,
    name: pat.name,
    expires_at: pat.expiresAt.toISOString(),
    last_used_at: pat.lastUsedAt?.toISOString() ?? null,
    created_at: pat.createdAt.toISOString(),
  };
}

function translateAgentAccessError(error: unknown): never {
  if (error instanceof AgentGrantNotFoundError) {
    throw new ClientError('Agent grant not found', 'not-found', {status: 404});
  }
  if (error instanceof AgentPersonalAccessTokenNotFoundError) {
    throw new ClientError('Personal access token not found', 'not-found', {status: 404});
  }
  if (error instanceof AgentAccessUserInactiveError) {
    throw new ClientError('User is not active', 'forbidden', {status: 403});
  }
  if (error instanceof AgentAccessWorkspaceError) {
    if (error.code === 'workspace-suspended') {
      throw new ClientError('Workspace is suspended', 'workspace-suspended', {status: 409});
    }
    if (error.code === 'workspace-inactive') {
      throw new ClientError('Workspace is not active', 'workspace-inactive', {status: 403});
    }
    throw new ClientError('Not a member of this workspace', 'forbidden', {status: 403});
  }
  if (error instanceof AuthDependencyUnavailableError) {
    throw new ClientError('Authentication dependency unavailable', 'auth-dependency-unavailable', {
      status: 503,
      cause: error,
    });
  }
  throw error;
}

const listGrantsRoute = defineRoute({
  method: 'GET',
  path: '/grants',
  description: "List the signed-in user's active agent access grants.",
  schema: {response: {200: listAgentGrantsResponseSchema}},
  errorHandler: translateAgentAccessError,
  handler: async (request) => ({
    grants: (await listAgentGrants({userId: requireActorId(request)})).map(toAgentGrantSummaryDto),
  }),
});

const revokeGrantRoute = defineRoute({
  method: 'DELETE',
  path: '/grants/:id',
  description: "Revoke one of the signed-in user's agent access grants.",
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

function createMintPersonalAccessTokenRoute(workspaces: WorkspacesInterModuleClient) {
  return defineRoute({
    method: 'POST',
    path: '/pats',
    description: 'Create a workspace-bound personal access token.',
    options: {bodyLimit: 8 * 1024},
    schema: {
      body: createAgentPersonalAccessTokenBodySchema,
      response: {201: createAgentPersonalAccessTokenResponseSchema},
    },
    errorHandler: translateAgentAccessError,
    handler: async (request, reply) => {
      const context = getUserContext(request);
      if (!context) {
        throw new ClientError('Authentication required', 'unauthorized', {status: 401});
      }
      rejectImpersonatedSession(request);

      const result = await createAgentPersonalAccessToken({
        userId: context.userId,
        workspaceId: request.body.workspace_id,
        name: request.body.name,
        expiresInDays: request.body.expires_in_days,
        workspaces,
      });
      reply.code(201);
      return {
        raw_token: result.token,
        ...toAgentPersonalAccessTokenSummaryDto(result.pat),
      };
    },
  });
}

const listPersonalAccessTokensRoute = defineRoute({
  method: 'GET',
  path: '/pats',
  description: "List the signed-in user's personal access token metadata.",
  schema: {response: {200: listAgentPersonalAccessTokensResponseSchema}},
  errorHandler: translateAgentAccessError,
  handler: async (request) => ({
    pats: (await listAgentPersonalAccessTokens({userId: requireActorId(request)})).map(
      toAgentPersonalAccessTokenSummaryDto,
    ),
  }),
});

const revokePersonalAccessTokenRoute = defineRoute({
  method: 'DELETE',
  path: '/pats/:id',
  description: "Revoke one of the signed-in user's personal access tokens.",
  schema: {
    params: agentAccessCredentialParamsSchema,
    response: {204: z.void()},
  },
  errorHandler: translateAgentAccessError,
  handler: async (request, reply) => {
    await revokeAgentPersonalAccessToken({userId: requireActorId(request), id: request.params.id});
    reply.code(204);
  },
});

/** Route group for grant listing and revocation. */
export function createAgentGrantRoutes(): RouteGroup {
  return {
    prefix: '/agent-access',
    auth: AUTH_USER,
    routes: [listGrantsRoute, revokeGrantRoute],
  };
}

/** Route group for PAT creation, listing, and revocation. */
export function createAgentPersonalAccessTokenRoutes(
  workspaces: WorkspacesInterModuleClient,
): RouteGroup {
  return {
    prefix: '/agent-access',
    auth: AUTH_USER,
    routes: [
      createMintPersonalAccessTokenRoute(workspaces),
      listPersonalAccessTokensRoute,
      revokePersonalAccessTokenRoute,
    ],
  };
}

/** Explicitly composes the dashboard-facing agent credential-management routes. */
export function createAgentAccessManagementRoutes(
  options: CreateAgentAccessManagementRoutesOptions,
): RouteGroup {
  return {
    prefix: '/agent-access',
    auth: AUTH_USER,
    routes: [
      listGrantsRoute,
      revokeGrantRoute,
      createMintPersonalAccessTokenRoute(options.workspaces),
      listPersonalAccessTokensRoute,
      revokePersonalAccessTokenRoute,
    ],
  };
}

export const createAgentAccessRoutes = createAgentAccessManagementRoutes;
