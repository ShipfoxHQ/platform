import {AUTH_USER} from '@shipfox/api-auth-context';
import {
  listRepositoriesParamsSchema,
  listRepositoriesQuerySchema,
  listRepositoriesResponseSchema,
} from '@shipfox/api-integration-core-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {defineRoute} from '@shipfox/node-fastify';
import {
  IntegrationCapabilityUnavailableError,
  IntegrationConnectionInactiveError,
  IntegrationConnectionNotFoundError,
} from '#core/errors.js';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import {getIntegrationConnectionById} from '#db/connections.js';
import {toRepositoryDto} from '#presentation/dto/integrations.js';
import {integrationRouteErrorHandler} from './errors.js';

export function createListRepositoriesRoute(registry: IntegrationProviderRegistry) {
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
      const connection = await getIntegrationConnectionById(connectionId);
      if (!connection) throw new IntegrationConnectionNotFoundError(connectionId);

      await requireMembership({request, workspaceId: connection.workspaceId});
      if (connection.lifecycleStatus !== 'active') {
        throw new IntegrationConnectionInactiveError(connection.id);
      }
      if (!connection.capabilities.includes('source_control')) {
        throw new IntegrationCapabilityUnavailableError('source_control', connection.provider);
      }

      const sourceControl = registry.getSourceControl(connection.provider);
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
