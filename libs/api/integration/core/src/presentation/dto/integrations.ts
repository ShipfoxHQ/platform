import type {IntegrationConnection} from '#core/entities/connection.js';
import type {RegisteredIntegrationProvider} from '#core/entities/provider.js';
import type {RepositorySnapshot} from '#core/providers/source-control.js';

export function toIntegrationProviderDto(provider: RegisteredIntegrationProvider) {
  return {
    provider: provider.provider,
    display_name: provider.displayName,
    capabilities: provider.capabilities,
  };
}

export function toIntegrationConnectionDto(
  connection: IntegrationConnection,
  provider: RegisteredIntegrationProvider,
) {
  return {
    id: connection.id,
    workspace_id: connection.workspaceId,
    provider: connection.provider,
    external_account_id: connection.externalAccountId,
    display_name: connection.displayName,
    lifecycle_status: connection.lifecycleStatus,
    capabilities: provider.capabilities,
    created_at: connection.createdAt.toISOString(),
    updated_at: connection.updatedAt.toISOString(),
  };
}

export function toRepositoryDto(connectionId: string, repository: RepositorySnapshot) {
  return {
    connection_id: connectionId,
    external_repository_id: repository.externalRepositoryId,
    owner: repository.owner,
    name: repository.name,
    full_name: repository.fullName,
    default_branch: repository.defaultBranch,
    visibility: repository.visibility,
    clone_url: repository.cloneUrl,
    html_url: repository.htmlUrl,
  };
}
