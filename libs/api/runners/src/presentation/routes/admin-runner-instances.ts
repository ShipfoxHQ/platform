import {AUTH_USER, requireUserContext} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import {
  listRunnerAdministratorInstancesQuerySchema,
  listRunnerAdministratorInstancesResponseSchema,
} from '@shipfox/api-runners-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {decodeTimestampIdCursor, encodeTimestampIdCursor} from '@shipfox/node-drizzle';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {listRunnerAdministratorInstances} from '#core/admin-runner-instances.js';
import {toRunnerAdministratorInstanceDto} from '#presentation/dto/admin-runner-instances.js';

function translateAdminRunnerInstancesRouteError(error: unknown): never {
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

export function createAdminRunnerInstancesRoute(
  auth: Pick<AuthInterModuleClient, 'requireAdminRole'>,
) {
  return defineRoute({
    method: 'GET',
    path: '/',
    auth: AUTH_USER,
    description: 'List bounded safe installation-managed runner instances for administrators.',
    schema: {
      querystring: listRunnerAdministratorInstancesQuerySchema,
      response: {200: listRunnerAdministratorInstancesResponseSchema},
    },
    errorHandler: translateAdminRunnerInstancesRouteError,
    handler: async (request) => {
      const actor = requireUserContext(request);
      await auth.requireAdminRole({userId: actor.userId, minimumRole: 'admin-observer'});

      const {state, assignment, label, limit, cursor} = request.query;
      const decodedCursor = decodeTimestampIdCursor(cursor);
      if (cursor !== undefined && !decodedCursor) {
        throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
      }

      const result = await listRunnerAdministratorInstances({
        state,
        assignment,
        label,
        limit,
        ...(decodedCursor ? {cursor: decodedCursor} : {}),
      });

      return {
        runners: result.runners.map(toRunnerAdministratorInstanceDto),
        next_cursor: result.nextCursor ? encodeTimestampIdCursor(result.nextCursor) : null,
      };
    },
  });
}
