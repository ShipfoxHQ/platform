import type {DefinitionSyncState} from '#core/entities/sync-state.js';
import type {DefinitionCursor, ListDefinitionsResult} from '#db/definitions.js';
import {listDefinitions} from '#db/definitions.js';
import {getLatestDefinitionSyncState} from '#db/sync-states.js';

export interface ListDefinitionsWithSyncParams {
  projectId: string;
  limit: number;
  cursor?: DefinitionCursor | undefined;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
}

export interface ListDefinitionsWithSyncResult extends ListDefinitionsResult {
  syncState: DefinitionSyncState | undefined;
}

export async function listDefinitionsWithSync(
  params: ListDefinitionsWithSyncParams,
): Promise<ListDefinitionsWithSyncResult> {
  // These are independent reads. The sync summary is the latest state observed
  // for the project and may advance while the definition page is being read.
  const [result, syncState] = await Promise.all([
    listDefinitions({projectId: params.projectId, limit: params.limit, cursor: params.cursor}),
    getLatestDefinitionSyncState({
      projectId: params.projectId,
      sourceConnectionId: params.sourceConnectionId,
      sourceExternalRepositoryId: params.sourceExternalRepositoryId,
    }),
  ]);

  return {...result, syncState};
}
