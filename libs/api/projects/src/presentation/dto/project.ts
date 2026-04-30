import type {Project} from '#core/entities/index.js';

export function toProjectDto(project: Project) {
  return {
    id: project.id,
    workspace_id: project.workspaceId,
    name: project.name,
    source: {
      connection_id: project.sourceConnectionId,
      external_repository_id: project.sourceExternalRepositoryId,
    },
    created_at: project.createdAt.toISOString(),
    updated_at: project.updatedAt.toISOString(),
  };
}
