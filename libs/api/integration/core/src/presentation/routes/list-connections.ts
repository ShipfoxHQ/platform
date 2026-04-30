import {AUTH_USER} from '@shipfox/api-auth-context';
import {
  listIntegrationConnectionsQuerySchema,
  listIntegrationConnectionsResponseSchema,
} from '@shipfox/api-integration-core-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {defineRoute} from '@shipfox/node-fastify';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import {listIntegrationConnections} from '#db/connections.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';

export function createListIntegrationConnectionsRoute(registry: IntegrationProviderRegistry) {
  return defineRoute({
    method: 'GET',
    path: '/integration-connections',
    auth: AUTH_USER,
    description: 'List active workspace integration connections.',
    schema: {
      querystring: listIntegrationConnectionsQuerySchema,
      response: {
        200: listIntegrationConnectionsResponseSchema,
      },
    },
    handler: async (request) => {
      const {workspace_id: workspaceId, capability} = request.query;

      await requireMembership({request, workspaceId});
      const connections = await listIntegrationConnections({workspaceId});
      const providers = new Map(
        registry.list(capability).map((provider) => [provider.provider, provider]),
      );
      const connectionDtos = connections
        .map((connection) => {
          const provider = providers.get(connection.provider);
          if (!provider) return undefined;
          return toIntegrationConnectionDto(connection, provider);
        })
        .filter((connection) => connection !== undefined);

      return {connections: connectionDtos};
    },
  });
}
