import type {Project} from '#core/entities/index.js';
import type {AdminProjectSummary} from '#db/projects.js';

export function toProjectDto(project: Project) {
  return {
    id: project.id,
    workspace_id: project.workspaceId,
    name: project.name,
    slug: project.slug,
    source: {
      connection_id: project.sourceConnectionId,
      external_repository_id: project.sourceExternalRepositoryId,
    },
    created_at: project.createdAt.toISOString(),
    updated_at: project.updatedAt.toISOString(),
  };
}

export function toAdminProjectSummaryDto(project: AdminProjectSummary) {
  return {
    id: project.id,
    name: project.name,
    status: 'active' as const,
    workspace_id: project.workspaceId,
    created_at: project.createdAt.toISOString(),
    updated_at: project.updatedAt.toISOString(),
  };
}
