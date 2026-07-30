import type {DefinitionDto, DefinitionSyncSummaryDto} from '@shipfox/api-definitions-dto';
import type {DefinitionSyncState} from '#core/entities/sync-state.js';
import type {WorkflowDefinition} from '#core/entities/workflow-definition.js';
import {UNRESOLVED_SYNC_REF} from '#core/sync-definitions.js';

export function toDefinitionDto(definition: WorkflowDefinition): DefinitionDto {
  const manualEntry = Object.entries(definition.document.triggers ?? {}).find(
    ([, trigger]) => trigger.source === 'manual',
  );
  return {
    id: definition.id,
    project_id: definition.projectId,
    config_path: definition.configPath,
    source: definition.source,
    sha: definition.sha,
    ref: definition.ref,
    name: definition.name,
    workflow_document: definition.document,
    workflow_model: definition.model,
    manual_trigger: manualEntry ? {name: manualEntry[0]} : null,
    fetched_at: definition.fetchedAt.toISOString(),
    created_at: definition.createdAt.toISOString(),
    updated_at: definition.updatedAt.toISOString(),
  };
}

export function toDefinitionSyncSummaryDto(
  syncState: DefinitionSyncState | undefined,
): DefinitionSyncSummaryDto | null {
  if (!syncState) return null;

  return {
    ref: syncState.ref === UNRESOLVED_SYNC_REF ? null : syncState.ref,
    status: syncState.status,
    last_sync_at: (syncState.finishedAt ?? syncState.updatedAt).toISOString(),
    started_at: syncState.startedAt?.toISOString() ?? null,
    finished_at: syncState.finishedAt?.toISOString() ?? null,
    last_error_code: syncState.lastErrorCode,
    last_error_message: syncState.lastErrorMessage,
    warnings: syncState.warnings,
  };
}
