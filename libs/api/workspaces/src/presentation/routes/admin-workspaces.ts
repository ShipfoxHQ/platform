import {AUTH_USER, getUserContext} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {
  listWorkspaceAdminSummariesResponseSchema,
  workspaceAdminLookupQuerySchema,
} from '@shipfox/api-workspaces-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {decodeStringIdCursor, encodeStringIdCursor} from '@shipfox/node-drizzle';
import {ClientError, defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import {
  listWorkspaceAdministratorSummaries,
  type WorkspaceAdministratorSummary,
} from '#core/admin-workspaces.js';

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
    errorHandler: (error) => {
      if (
        isInterModuleKnownError(authInterModuleContract.methods.requireAdminRole, error) &&
        error.code === 'admin-role-required'
      ) {
        throw new ClientError('Administrator observer role required', 'forbidden', {
          status: 403,
          details: {required_role: error.details.requiredRole},
        });
      }
      throw error;
    },
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

  return {prefix: '/admin/workspaces', routes: [listRoute]};
}
