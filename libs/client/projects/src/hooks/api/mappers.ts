import type {DefinitionDto, DefinitionSyncSummaryDto} from '@shipfox/api-definitions-dto';
import type {ProjectResponseDto} from '@shipfox/api-projects-dto';
import type {Definition, DefinitionList, DefinitionSyncSummary} from '#core/definition.js';
import type {Project, ProjectList} from '#core/project.js';

export function toProject(dto: ProjectResponseDto): Project {
  return {
    id: dto.id,
    workspaceId: dto.workspace_id,
    name: dto.name,
    slug: dto.slug,
    source: {
      connectionId: dto.source.connection_id,
      externalRepositoryId: dto.source.external_repository_id,
    },
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export function toProjectList(dto: {
  projects: ProjectResponseDto[];
  next_cursor: string | null;
}): ProjectList {
  return {projects: dto.projects.map(toProject), nextCursor: dto.next_cursor};
}

export function toDefinition(dto: DefinitionDto): Definition {
  return {
    id: dto.id,
    projectId: dto.project_id,
    configPath: dto.config_path,
    source: dto.source,
    sha: dto.sha,
    ref: dto.ref,
    name: dto.name,
    workflowDocument: dto.workflow_document,
    workflowModel: dto.workflow_model,
    manualTrigger: dto.manual_trigger,
    fetchedAt: dto.fetched_at,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export function toDefinitionSyncSummary(dto: DefinitionSyncSummaryDto): DefinitionSyncSummary {
  return {
    ref: dto.ref,
    status: dto.status,
    lastSyncAt: dto.last_sync_at,
    startedAt: dto.started_at,
    finishedAt: dto.finished_at,
    lastErrorCode: dto.last_error_code,
    lastErrorMessage: dto.last_error_message,
    warnings: dto.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
      ...(warning.path === undefined ? {} : {path: warning.path}),
    })),
  };
}

export function toDefinitionList(dto: {
  definitions: DefinitionDto[];
  sync: DefinitionSyncSummaryDto | null;
  next_cursor: string | null;
}): DefinitionList {
  return {
    definitions: dto.definitions.map(toDefinition),
    sync: dto.sync && toDefinitionSyncSummary(dto.sync),
    nextCursor: dto.next_cursor,
  };
}
