import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export type {
  ApplyVcsDefinitionsBatchParams,
  ApplyVcsDefinitionsBatchResult,
  ListDefinitionsParams,
  ListDefinitionsResult,
  SoftDeleteVcsDefinitionsParams,
  UpsertDefinitionParams,
} from './definitions.js';
export {
  applyVcsDefinitionsBatch,
  findOrCreateWorkflowLineage,
  getDefinitionById,
  invalidateCache,
  listDefinitions,
  listDefinitionsByProject,
  softDeleteVcsDefinitionsNotIn,
  upsertDefinition,
} from './definitions.js';
export {definitionsOutbox} from './schema/outbox.js';
export {definitionSyncStates} from './schema/sync-states.js';
export {type WorkflowCreateDb, type WorkflowDb, workflowWorkflows} from './schema/workflows.js';
export {
  type DefinitionSyncStateKey,
  getLatestDefinitionSyncState,
  type MarkDefinitionSyncParams,
  markDefinitionSyncState,
} from './sync-states.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
