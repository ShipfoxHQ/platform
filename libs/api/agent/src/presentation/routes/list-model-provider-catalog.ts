import {
  type ManagedModelProvider,
  modelProviderCatalogResponseSchema,
  type WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {buildModelProviderCatalogResponse} from '#core/index.js';
import {toModelProviderCatalogResponseDto} from '#presentation/dto/index.js';

export function createListModelProviderCatalogRoute(
  options: {
    managedProvider?: ManagedModelProvider | undefined;
    workspaceProviders?: WorkspaceProvidersPolicy | undefined;
  } = {},
) {
  const workspaceProviders = options.workspaceProviders ?? 'enabled';

  return defineRoute({
    method: 'GET',
    path: '/model-provider-catalog',
    description: 'List available model providers and models',
    schema: {
      response: {
        200: modelProviderCatalogResponseSchema,
      },
    },
    handler: () =>
      toModelProviderCatalogResponseDto(
        buildModelProviderCatalogResponse({
          managedProvider: options.managedProvider,
          workspaceProviders,
        }),
      ),
  });
}

export const listModelProviderCatalogRoute = createListModelProviderCatalogRoute();
