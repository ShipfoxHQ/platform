import {AUTH_USER, adoptAdministrationActorGuard, getUserContext} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {
  listWorkspaceAdminSummariesResponseSchema,
  workspaceAdministrationMutationBodySchema,
  workspaceAdministrationMutationResponseSchema,
  workspaceAdminLookupQuerySchema,
} from '@shipfox/api-workspaces-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {decodeStringIdCursor, encodeStringIdCursor} from '@shipfox/node-drizzle';
import {ClientError, defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import {
  listWorkspaceAdministratorSummaries,
  reactivateWorkspace,
  suspendWorkspace,
  type WorkspaceAdministrationMutationContext,
  type WorkspaceAdministratorSummary,
} from '#core/admin-workspaces.js';
import {
  WorkspaceAdminIdempotencyKeyReuseError,
  WorkspaceAlreadySuspendedError,
  WorkspaceDeletedError,
  WorkspaceNotFoundError,
  WorkspaceNotSuspendedError,
} from '#core/errors.js';

const idempotencyKeyMaxLength = 256;

function requireActorId(request: FastifyRequest): string {
  const client = getUserContext(request);
  if (!client) {
    throw new ClientError('Authentication required', 'unauthorized', {status: 401});
  }
  return client.userId;
}

function requireIdempotencyKey(request: FastifyRequest): string {
  const value = request.headers['idempotency-key'];
  const key = Array.isArray(value) ? value[0] : value;
  if (!key || key.trim().length === 0 || key.length > idempotencyKeyMaxLength) {
    throw new ClientError('Idempotency-Key header is required', 'idempotency-key-required', {
      status: 400,
    });
  }
  return key;
}

function translateAdminRoleError(error: unknown, message: string): void {
  if (
    isInterModuleKnownError(authInterModuleContract.methods.requireAdminRole, error) &&
    error.code === 'admin-role-required'
  ) {
    throw new ClientError(message, 'forbidden', {
      status: 403,
      details: {required_role: error.details.requiredRole},
    });
  }
}

function translateAdministrationError(error: unknown): never {
  translateAdminRoleError(error, 'Administrator operator role required');
  if (error instanceof WorkspaceNotFoundError) {
    throw new ClientError('Workspace not found', 'workspace-not-found', {status: 404});
  }
  if (error instanceof WorkspaceDeletedError) {
    throw new ClientError('Workspace is deleted', 'workspace-deleted', {status: 409});
  }
  if (error instanceof WorkspaceAlreadySuspendedError) {
    throw new ClientError('Workspace is already suspended', 'workspace-already-suspended', {
      status: 409,
    });
  }
  if (error instanceof WorkspaceNotSuspendedError) {
    throw new ClientError('Workspace is not suspended', 'workspace-not-suspended', {
      status: 409,
    });
  }
  if (error instanceof WorkspaceAdminIdempotencyKeyReuseError) {
    throw new ClientError(
      'Idempotency-Key was already used for a different workspace command',
      'idempotency-key-reused',
      {status: 409},
    );
  }
  throw error;
}

function translateObserverAdministrationError(error: unknown): never {
  translateAdminRoleError(error, 'Administrator observer role required');
  throw error;
}

function toWorkspaceAdministrationMutationDto(result: {
  workspaceId: string;
  status: 'active' | 'suspended';
  correlationId: string;
}) {
  return {
    workspace_id: result.workspaceId,
    status: result.status,
    correlation_id: result.correlationId,
  };
}

function toWorkspaceAdministratorSummaryDto(summary: WorkspaceAdministratorSummary) {
  return {
    id: summary.id,
    name: summary.name,
    status: summary.status,
    member_summary: summary.memberSummary,
    project_summary: summary.projectSummary,
    job_counts: summary.jobCounts,
    created_at: summary.createdAt.toISOString(),
    updated_at: summary.updatedAt.toISOString(),
  };
}

export function createAdminWorkspacesRoutes(params: {
  auth: AuthInterModuleClient;
  projects: ProjectsModuleClient;
  runners: RunnersInterModuleClient;
}): RouteGroup {
  const listRoute = defineRoute({
    method: 'GET',
    path: '/',
    description: 'List bounded safe workspace summaries for administrators.',
    auth: AUTH_USER,
    schema: {
      querystring: workspaceAdminLookupQuerySchema,
      response: {200: listWorkspaceAdminSummariesResponseSchema},
    },
    errorHandler: translateObserverAdministrationError,
    handler: async (request) => {
      const client = getUserContext(request);
      if (!client) {
        throw new ClientError('Authentication required', 'unauthorized', {status: 401});
      }
      await params.auth.requireAdminRole({
        userId: client.userId,
        minimumRole: 'admin-observer',
      });

      const {workspace_id: workspaceId, search, status, limit, cursor} = request.query;
      const decodedCursor = decodeStringIdCursor(cursor);
      if (cursor && !decodedCursor) {
        throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
      }

      const result = await listWorkspaceAdministratorSummaries({
        workspaceId,
        search,
        status,
        limit,
        cursor: decodedCursor,
        projects: params.projects,
        runners: params.runners,
      });

      return {
        workspaces: result.workspaces.map(toWorkspaceAdministratorSummaryDto),
        next_cursor: result.nextCursor ? encodeStringIdCursor(result.nextCursor) : null,
      };
    },
  });

  const createMutationRoute = (routeParams: {
    action: 'suspend' | 'reactivate';
    description: string;
    execute: (context: WorkspaceAdministrationMutationContext) => Promise<{
      workspaceId: string;
      status: 'active' | 'suspended';
      correlationId: string;
    }>;
  }) =>
    defineRoute({
      method: 'POST',
      path: `/:workspaceId/${routeParams.action}`,
      description: routeParams.description,
      auth: AUTH_USER,
      schema: {
        params: z.object({workspaceId: z.string().uuid()}),
        body: workspaceAdministrationMutationBodySchema,
        response: {200: workspaceAdministrationMutationResponseSchema},
      },
      errorHandler: translateAdministrationError,
      handler: async (request) => {
        const actorId = requireActorId(request);
        const actorRole = (
          await params.auth.requireAdminRole({userId: actorId, minimumRole: 'admin-operator'})
        ).role;
        return toWorkspaceAdministrationMutationDto(
          await routeParams.execute({
            actorId,
            actorRole,
            workspaceId: request.params.workspaceId,
            reason: request.body.reason,
            idempotencyKey: requireIdempotencyKey(request),
            correlationId: request.id,
          }),
        );
      },
    });

  const suspendRoute = createMutationRoute({
    action: 'suspend',
    description: 'Suspend a workspace for reversible administrator moderation.',
    execute: suspendWorkspace,
  });
  const reactivateRoute = createMutationRoute({
    action: 'reactivate',
    description: 'Reactivate a suspended workspace.',
    execute: reactivateWorkspace,
  });

  return adoptAdministrationActorGuard({
    prefix: '/admin/workspaces',
    routes: [listRoute, suspendRoute, reactivateRoute],
  });
}
