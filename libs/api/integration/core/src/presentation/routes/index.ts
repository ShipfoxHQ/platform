import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import type {RouteExport} from '@shipfox/node-fastify';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import type {RepositoryAuthorizer} from '#core/repository-authorizer.js';
import type {IntegrationSourceControlService} from '#core/source-control-service.js';
import type {GetIntegrationConnectionByIdFn} from '#db/connections.js';
import {
  createAgentToolsGatewayRoutes,
  createWorkflowsLeasedAgentStepLoader,
} from './agent-tools-gateway/index.js';
import {createListIntegrationConnectionsRoute} from './list-connections.js';
import {createListIntegrationProvidersRoute} from './list-providers.js';
import {createListRepositoriesRoute} from './list-repositories.js';
import {
  createDeleteIntegrationConnectionRoute,
  createUpdateIntegrationConnectionRoute,
} from './manage-connections.js';
import {createRepositoryAccessMutationRoutes} from './repository-access.js';

export interface CreateIntegrationRoutesOptions {
  repositoryAuthorization?:
    | {
        invalidateRepositoryAuthorizationCache?: ((connectionId: string) => void) | undefined;
      }
    | undefined;
  agentTools?:
    | {
        workflows: WorkflowsModuleClient;
        getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
        repositoryAuthorizer?: RepositoryAuthorizer | undefined;
      }
    | undefined;
}

export function createIntegrationRoutes(
  registry: IntegrationProviderRegistry,
  sourceControl: IntegrationSourceControlService,
  options: CreateIntegrationRoutesOptions = {},
): RouteExport[] {
  const providerRoutes = registry.list().flatMap((provider) => provider.routes ?? []);
  const agentToolsRoutes = options.agentTools
    ? [
        createAgentToolsGatewayRoutes({
          registry,
          loadLeasedAgentStep: createWorkflowsLeasedAgentStepLoader(options.agentTools.workflows),
          getIntegrationConnectionById: options.agentTools.getIntegrationConnectionById,
          repositoryAuthorizer: options.agentTools.repositoryAuthorizer,
        }),
      ]
    : [];

  return [
    createListIntegrationProvidersRoute(registry),
    createListIntegrationConnectionsRoute(registry),
    createUpdateIntegrationConnectionRoute(registry),
    createDeleteIntegrationConnectionRoute(registry),
    ...createRepositoryAccessMutationRoutes({
      registry,
      invalidateRepositoryAuthorizationCache:
        options.repositoryAuthorization?.invalidateRepositoryAuthorizationCache,
    }),
    createListRepositoriesRoute(sourceControl),
    ...agentToolsRoutes,
    ...providerRoutes,
  ];
}
