import type {WorkspaceDto} from '@shipfox/api-workspaces-dto';
import type {Workspace} from '#core/entities/workspace.js';

export function toWorkspaceDto(workspace: Workspace): WorkspaceDto {
  return {
    id: workspace.id,
    name: workspace.name,
    status: workspace.status,
    settings: workspace.settings,
    created_at: workspace.createdAt.toISOString(),
    updated_at: workspace.updatedAt.toISOString(),
  };
}
