import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath, projectsOutbox} from '#db/index.js';
import {routes} from '#presentation/index.js';

export type {
  Project,
  ProjectWithRepository,
  Repository,
  VcsConnection,
  VcsProviderKind,
} from '#core/index.js';
export {
  createProjectFromRepository,
  ProjectAccessDeniedError,
  ProjectAlreadyExistsError,
  ProjectNotFoundError,
  resetVcsProviderRegistry,
  setVcsProviderRegistry,
  VcsConnectionNotFoundError,
  VcsProviderError,
  vcsProviderRegistry,
} from '#core/index.js';
export {
  createVcsConnection,
  db,
  getProjectById,
  getVcsConnectionById,
  listProjects,
  migrationsPath,
  projectsOutbox,
  requireProjectForWorkspace,
  upsertRepository,
} from '#db/index.js';
export {requireProjectAccess, routes} from '#presentation/index.js';

export const projectsModule: ShipfoxModule = {
  name: 'projects',
  database: {db, migrationsPath},
  routes,
  publishers: [{name: 'projects', table: projectsOutbox, db}],
};
