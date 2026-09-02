import {
  DEFINITION_SYNC_LAST_ERROR_MESSAGE_MAX_LENGTH,
  type DefinitionDto,
  type DefinitionSyncSummaryDto,
} from '@shipfox/api-definitions-dto';
import type {DefinitionSyncState} from '#core/entities/sync-state.js';
import type {WorkflowDefinition} from '#core/entities/workflow-definition.js';
import {UNRESOLVED_SYNC_REF} from '#core/sync-definitions.js';

/**
 * Maps a definition to the JSON-safe camelCase shape shared by HTTP and
 * inter-module presentations.
 */
export function toDefinitionReadModel(definition: WorkflowDefinition) {
  // The model excludes inert triggers, so an inert manual trigger yields no Run
  // button instead of a fire-route 404. The document keeps the authored entry.
  const manualTrigger = definition.model.triggers.find((trigger) => trigger.source === 'manual');
  return {
    id: definition.id,
    projectId: definition.projectId,
    configPath: definition.configPath,
    source: definition.source,
    sha: definition.sha,
    ref: definition.ref,
    name: definition.name,
    workflowDocument: definition.document,
    workflowModel: definition.model,
    manualTrigger: manualTrigger ? {name: manualTrigger.key} : null,
    fetchedAt: definition.fetchedAt.toISOString(),
    createdAt: definition.createdAt.toISOString(),
    updatedAt: definition.updatedAt.toISOString(),
  };
}

/** Maps a sync state to the JSON-safe camelCase shape shared by presentations. */
export function toDefinitionSyncSummary(syncState: DefinitionSyncState | undefined) {
  if (!syncState) return null;

  return {
    ref: syncState.ref === UNRESOLVED_SYNC_REF ? null : syncState.ref,
    status: syncState.status,
    lastSyncAt: (syncState.finishedAt ?? syncState.updatedAt).toISOString(),
    startedAt: syncState.startedAt?.toISOString() ?? null,
    finishedAt: syncState.finishedAt?.toISOString() ?? null,
    lastErrorCode: syncState.lastErrorCode,
    lastErrorMessage:
      syncState.lastErrorMessage?.slice(0, DEFINITION_SYNC_LAST_ERROR_MESSAGE_MAX_LENGTH) ?? null,
    diagnostics: syncState.diagnostics.map(({filePath, ...diagnostic}) => ({
      ...diagnostic,
      ...(filePath === undefined ? {} : {filePath}),
    })),
  };
}

export function toDefinitionDto(definition: WorkflowDefinition): DefinitionDto {
  const readModel = toDefinitionReadModel(definition);
  return {
    id: readModel.id,
    project_id: readModel.projectId,
    config_path: readModel.configPath,
    source: readModel.source,
    sha: readModel.sha,
    ref: readModel.ref,
    name: readModel.name,
    workflow_document: readModel.workflowDocument,
    workflow_model: readModel.workflowModel,
    manual_trigger: readModel.manualTrigger,
    fetched_at: readModel.fetchedAt,
    created_at: readModel.createdAt,
    updated_at: readModel.updatedAt,
  };
}

export function toDefinitionSyncSummaryDto(
  syncState: DefinitionSyncState | undefined,
): DefinitionSyncSummaryDto | null {
  const readModel = toDefinitionSyncSummary(syncState);
  if (!readModel) return null;

  return {
    ref: readModel.ref,
    status: readModel.status,
    last_sync_at: readModel.lastSyncAt,
    started_at: readModel.startedAt,
    finished_at: readModel.finishedAt,
    last_error_code: readModel.lastErrorCode,
    last_error_message: readModel.lastErrorMessage,
    diagnostics: readModel.diagnostics.map(({filePath, ...diagnostic}) => ({
      ...diagnostic,
      ...(filePath === undefined ? {} : {file_path: filePath}),
    })),
  };
}
