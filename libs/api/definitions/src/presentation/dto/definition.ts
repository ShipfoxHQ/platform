import type {DefinitionDto} from '@shipfox/api-definitions-dto';
import type {WorkflowDefinition} from '#core/entities/definition.js';

export function toDefinitionDto(definition: WorkflowDefinition): DefinitionDto {
  return {
    id: definition.id,
    project_id: definition.projectId,
    config_path: definition.configPath,
    source: definition.source,
    sha: definition.sha,
    ref: definition.ref,
    name: definition.name,
    definition: definition.definition as unknown as Record<string, unknown>,
    fetched_at: definition.fetchedAt.toISOString(),
    created_at: definition.createdAt.toISOString(),
    updated_at: definition.updatedAt.toISOString(),
  };
}
