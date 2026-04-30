import type {RouteExport} from '@shipfox/node-fastify';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import type {IntegrationSourceControlService} from '#core/source-control-service.js';
import {createListIntegrationConnectionsRoute} from './list-connections.js';
import {createListIntegrationProvidersRoute} from './list-providers.js';
import {createListRepositoriesRoute} from './list-repositories.js';

export function createIntegrationRoutes(
  registry: IntegrationProviderRegistry,
  sourceControl: IntegrationSourceControlService,
): RouteExport[] {
  const providerRoutes = registry.list().flatMap((provider) => provider.routes ?? []);

  return [
    createListIntegrationProvidersRoute(registry),
    createListIntegrationConnectionsRoute(registry),
    createListRepositoriesRoute(sourceControl),
    ...providerRoutes,
  ];
}
