import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export type {CreateProjectParams, ListProjectsParams, ListProjectsResult} from './projects.js';
export {
  createProject,
  getProjectById,
  listProjects,
  requireProjectForWorkspace,
} from './projects.js';
export type {RepositorySnapshot, UpsertRepositoryParams} from './repositories.js';
export {upsertRepository} from './repositories.js';
export {projectsOutbox} from './schema/outbox.js';
export type {CreateVcsConnectionParams} from './vcs-connections.js';
export {createVcsConnection, getVcsConnectionById} from './vcs-connections.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
