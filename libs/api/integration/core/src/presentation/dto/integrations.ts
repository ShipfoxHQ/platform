import type {IntegrationConnectionRepositoryAccessRepositoryDto} from '@shipfox/api-integration-spi';
import type {IntegrationConnection} from '#core/entities/connection.js';
import type {
  IntegrationCapability,
  RegisteredIntegrationProvider,
} from '#core/entities/provider.js';
import type {RepositorySnapshot} from '#core/providers/source-control.js';
import type {RepositoryAccessRepository} from '#core/repository-access-read.js';

export function toIntegrationProviderDto(provider: RegisteredIntegrationProvider) {
  return {
    provider: provider.provider,
    display_name: provider.displayName,
    capabilities: provider.capabilities,
  };
}

export function toIntegrationConnectionDto(
  connection: IntegrationConnection,
  options: {
    capabilities: IntegrationCapability[];
    externalUrl?: string | undefined;
  },
) {
  return mapIntegrationConnection(connection, options.capabilities, options.externalUrl);
}

function mapIntegrationConnection(
  connection: IntegrationConnection,
  capabilities: IntegrationCapability[],
  externalUrl?: string,
) {
  return {
    id: connection.id,
    workspace_id: connection.workspaceId,
    provider: connection.provider,
    external_account_id: connection.externalAccountId,
    slug: connection.slug,
    display_name: connection.displayName,
    lifecycle_status: connection.lifecycleStatus,
    capabilities,
    ...(externalUrl ? {external_url: externalUrl} : {}),
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

export function toRepositoryAccessRepositoryDto(
  repository: RepositoryAccessRepository,
): IntegrationConnectionRepositoryAccessRepositoryDto {
  return {
    external_repository_id: repository.externalRepositoryId,
    owner: repository.owner,
    name: repository.name,
    project_id: repository.projectId,
    project_name: repository.projectName,
    project_slug: repository.projectSlug,
  };
}
