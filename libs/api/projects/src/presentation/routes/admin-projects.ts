import {AUTH_USER, requireUserContext} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import {
  listAdminProjectsQuerySchema,
  listAdminProjectsResponseSchema,
} from '@shipfox/api-projects-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {listAdminProjects} from '#db/index.js';
import {toAdminProjectSummaryDto} from '#presentation/dto/index.js';
import {decodeProjectCursor, encodeProjectCursor} from './cursor.js';

const minimumRole = 'admin-observer' as const;

function translateAdminProjectRouteError(error: unknown): never {
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
}

export function createAdminProjectsRoute(auth: Pick<AuthInterModuleClient, 'requireAdminRole'>) {
  return defineRoute({
    method: 'GET',
    path: '/',
    auth: AUTH_USER,
    description: 'List a bounded safe project summary for administrators.',
    schema: {
      querystring: listAdminProjectsQuerySchema,
      response: {200: listAdminProjectsResponseSchema},
    },
    errorHandler: translateAdminProjectRouteError,
    handler: async (request) => {
      const actor = requireUserContext(request);
      await auth.requireAdminRole({userId: actor.userId, minimumRole});

      const {project_id: projectId, limit, cursor, search} = request.query;
      const decodedCursor = decodeProjectCursor(cursor);
      if (cursor && !decodedCursor) {
        throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
      }

      const result = await listAdminProjects({
        projectId,
        limit,
        cursor: decodedCursor,
        search,
      });

      return {
        projects: result.projects.map(toAdminProjectSummaryDto),
        next_cursor: result.nextCursor ? encodeProjectCursor(result.nextCursor) : null,
      };
    },
  });
}
