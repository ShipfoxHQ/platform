import type {IntegrationSourceControlService} from '@shipfox/api-integration-core';
import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath, projectsOutbox} from '#db/index.js';
import {createProjectRoutes} from '#presentation/index.js';

export type {Project} from '#core/index.js';
export {
  createProjectFromSource,
  ProjectAccessDeniedError,
  ProjectAlreadyExistsError,
  ProjectNotFoundError,
} from '#core/index.js';
export {
  createProject,
  db,
  getProjectById,
  listProjects,
  migrationsPath,
  projectsOutbox,
  requireProjectForWorkspace,
} from '#db/index.js';
export {createProjectRoutes, requireProjectAccess} from '#presentation/index.js';

export interface CreateProjectsModuleOptions {
  sourceControl: IntegrationSourceControlService;
}

export function createProjectsModule({sourceControl}: CreateProjectsModuleOptions): ShipfoxModule {
  return {
    name: 'projects',
    database: {db, migrationsPath},
    routes: createProjectRoutes(sourceControl),
    publishers: [{name: 'projects', table: projectsOutbox, db}],
  };
}
