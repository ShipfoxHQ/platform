import type {
  IntegrationConnectionDto,
  IntegrationConnectionRepositoryAccessRepositoryDto,
  IntegrationConnectionRepositoryAccessResponseDto,
  IntegrationProviderDto,
  RepositoryDto,
} from '@shipfox/api-integration-core-dto';
import type {JiraAccessibleResourceDto} from '@shipfox/api-integration-jira-dto';
import type {WebhookConnectionDto} from '@shipfox/api-integration-webhook-dto';
import type {
  InstallRedirect,
  IntegrationConnection,
  IntegrationProvider,
  JiraSite,
  Repository,
  RepositoryAccess,
  RepositoryAccessRepository,
  WebhookConnection,
} from '#core/models.js';

export function toIntegrationProvider(dto: IntegrationProviderDto): IntegrationProvider {
  return {provider: dto.provider, displayName: dto.display_name, capabilities: dto.capabilities};
}

export function toInstallRedirect(dto: {install_url: string}): InstallRedirect {
  return {installUrl: dto.install_url};
}

export function toJiraSite(dto: JiraAccessibleResourceDto): JiraSite {
  return {cloudId: dto.cloud_id, name: dto.name, url: dto.url, scopes: dto.scopes};
}

export function toIntegrationConnection(dto: IntegrationConnectionDto): IntegrationConnection {
  return {
    id: dto.id,
    workspaceId: dto.workspace_id,
    provider: dto.provider,
    externalAccountId: dto.external_account_id,
    slug: dto.slug,
    displayName: dto.display_name,
    lifecycleStatus: dto.lifecycle_status,
    capabilities: dto.capabilities,
    externalUrl: dto.external_url,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export function toRepository(dto: RepositoryDto): Repository {
  return {
    connectionId: dto.connection_id,
    externalRepositoryId: dto.external_repository_id,
    owner: dto.owner,
    name: dto.name,
    fullName: dto.full_name,
    defaultBranch: dto.default_branch,
    visibility: dto.visibility,
    cloneUrl: dto.clone_url,
    htmlUrl: dto.html_url,
  };
}

function toRepositoryAccessRepository(
  dto: IntegrationConnectionRepositoryAccessRepositoryDto,
): RepositoryAccessRepository {
  return {
    externalRepositoryId: dto.external_repository_id,
    owner: dto.owner,
    name: dto.name,
    projectId: dto.project_id,
    projectName: dto.project_name,
  };
}

export function toRepositoryAccess(
  dto: IntegrationConnectionRepositoryAccessResponseDto,
): RepositoryAccess {
  return {
    mode: dto.mode,
    repositories: dto.repositories.map(toRepositoryAccessRepository),
    ...(dto.next_cursor == null ? {} : {nextCursor: dto.next_cursor}),
  };
}

export function toWebhookConnection(dto: WebhookConnectionDto): WebhookConnection {
  return {
    id: dto.id,
    workspaceId: dto.workspace_id,
    name: dto.name,
    slug: dto.slug,
    lifecycleStatus: dto.lifecycle_status,
    inboundUrl: dto.inbound_url,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}
