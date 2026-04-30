import {AUTH_USER} from '@shipfox/api-auth-context';
import {
  listRepositoriesParamsSchema,
  listRepositoriesQuerySchema,
  listRepositoriesResponseSchema,
} from '@shipfox/api-integration-core-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {defineRoute} from '@shipfox/node-fastify';
import type {IntegrationSourceControlService} from '#core/source-control-service.js';
import {toRepositoryDto} from '#presentation/dto/integrations.js';
import {integrationRouteErrorHandler} from './errors.js';

export function createListRepositoriesRoute(sourceControl: IntegrationSourceControlService) {
  return defineRoute({
    method: 'GET',
    path: '/integration-connections/:connectionId/repositories',
    auth: AUTH_USER,
    description: 'List repositories visible to a source-control integration connection.',
    schema: {
      params: listRepositoriesParamsSchema,
      querystring: listRepositoriesQuerySchema,
      response: {
        200: listRepositoriesResponseSchema,
      },
    },
    errorHandler: integrationRouteErrorHandler,
    handler: async (request) => {
      const {connectionId} = request.params;
      const connection = await sourceControl.getConnection(connectionId);

      await requireMembership({request, workspaceId: connection.workspaceId});

      const page = await sourceControl.listRepositories({
        connection,
        limit: request.query.limit,
        cursor: request.query.cursor,
      });

      return {
        repositories: page.repositories.map((repository) =>
          toRepositoryDto(connection.id, repository),
        ),
        next_cursor: page.nextCursor,
      };
    },
  });
}
