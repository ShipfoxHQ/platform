import type {ModelProviderCatalogResponseDto} from '@shipfox/api-agent-dto';
import type {ModelProviderCatalogResponse} from '#core/model-provider-catalog.js';

export function toModelProviderCatalogResponseDto(
  response: ModelProviderCatalogResponse,
): ModelProviderCatalogResponseDto {
  return {
    providers: [...response.providers],
    workspace_providers: response.workspaceProviders,
    managed_provider_id: response.managedProviderId,
    instance_default_provider_id: response.instanceDefaultProviderId,
  };
}
