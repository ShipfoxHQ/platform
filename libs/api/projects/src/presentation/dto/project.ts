import type {ProjectWithRepository, Repository, VcsConnection} from '#core/entities/index.js';

export function toVcsConnectionDto(connection: VcsConnection) {
  return {
    id: connection.id,
    workspace_id: connection.workspaceId,
    provider: connection.provider,
    provider_host: connection.providerHost,
    external_connection_id: connection.externalConnectionId,
    display_name: connection.displayName,
    created_at: connection.createdAt.toISOString(),
    updated_at: connection.updatedAt.toISOString(),
  };
}

export function toRepositoryDto(repository: Repository) {
  return {
    id: repository.id,
    vcs_connection_id: repository.vcsConnectionId,
    provider: repository.provider,
    provider_host: repository.providerHost,
    external_repository_id: repository.externalRepositoryId,
    owner: repository.owner,
    name: repository.name,
    full_name: repository.fullName,
    default_branch: repository.defaultBranch,
    visibility: repository.visibility,
    clone_url: repository.cloneUrl,
    html_url: repository.htmlUrl,
    metadata_fetched_at: repository.metadataFetchedAt.toISOString(),
    created_at: repository.createdAt.toISOString(),
    updated_at: repository.updatedAt.toISOString(),
  };
}

export function toProjectDto(project: ProjectWithRepository) {
  return {
    id: project.id,
    workspace_id: project.workspaceId,
    repository_id: project.repositoryId,
    name: project.name,
    repository: toRepositoryDto(project.repository),
    created_at: project.createdAt.toISOString(),
    updated_at: project.updatedAt.toISOString(),
  };
}
