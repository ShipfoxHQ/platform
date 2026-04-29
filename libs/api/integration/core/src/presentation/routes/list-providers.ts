import {AUTH_USER} from '@shipfox/api-auth-context';
import {
  listIntegrationProvidersQuerySchema,
  listIntegrationProvidersResponseSchema,
} from '@shipfox/api-integration-core-dto';
import {defineRoute} from '@shipfox/node-fastify';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import {toIntegrationProviderDto} from '#presentation/dto/integrations.js';

export function createListIntegrationProvidersRoute(registry: IntegrationProviderRegistry) {
  return defineRoute({
    method: 'GET',
    path: '/integration-providers',
    auth: AUTH_USER,
    description: 'List integration providers available to the API.',
    schema: {
      querystring: listIntegrationProvidersQuerySchema,
      response: {
        200: listIntegrationProvidersResponseSchema,
      },
    },
    handler: async (request) => {
      await Promise.resolve();
      const providers = registry.list(request.query.capability);
      return {providers: providers.map(toIntegrationProviderDto)};
    },
  });
}
