import type {WorkspaceResponseDto} from '@shipfox/api-workspaces-dto';
import type {Workspace} from '#core/auth.js';

export function toWorkspace(dto: WorkspaceResponseDto): Workspace {
  return {id: dto.id, name: dto.name, slug: dto.slug, status: dto.status};
}
