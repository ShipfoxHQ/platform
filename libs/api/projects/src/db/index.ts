import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export {
  pruneIntegrationEventDedup,
  recordIntegrationEventForProject,
} from './integration-event-dedup.js';
export type {
  AdminProjectSummary,
  CreateProjectParams,
  GetProjectBySourceParams,
  ListAdminProjectsParams,
  ListAdminProjectsResult,
  ListProjectsParams,
  ListProjectsResult,
} from './projects.js';
export {
  createProject,
  getProjectById,
  getProjectBySource,
  getProjectCount,
  getWorkspaceProjectCounts,
  listAdminProjects,
  listProjects,
  requireProjectForWorkspace,
} from './projects.js';
export {projectsIntegrationEventDedup} from './schema/integration-event-dedup.js';
export {projectsOutbox} from './schema/outbox.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
