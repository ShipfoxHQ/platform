import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export type {UpsertDefinitionParams} from './definitions.js';
export {
  getDefinitionById,
  invalidateCache,
  listDefinitionsByProject,
  upsertDefinition,
} from './definitions.js';
export {definitionsOutbox} from './schema/outbox.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
