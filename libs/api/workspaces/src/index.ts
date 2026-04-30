import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath} from '#db/index.js';
import {createApiKeyAuthMethod} from '#presentation/auth/api-key-auth.js';
import {workspacesRoutes} from '#presentation/routes/index.js';

export type {ApiKey} from '#core/entities/api-key.js';
export type {Invitation} from '#core/entities/invitation.js';
export type {Membership} from '#core/entities/membership.js';
export type {Workspace, WorkspaceStatus} from '#core/entities/workspace.js';
export {requireWorkspaceMembership} from '#core/workspaces.js';
export {db, migrationsPath} from '#db/index.js';
export {createApiKeyAuthMethod} from '#presentation/auth/api-key-auth.js';
export {requireMembership} from '#presentation/auth/require-membership.js';
export {workspacesRoutes as routes} from '#presentation/routes/index.js';

export const workspacesModule: ShipfoxModule = {
  name: 'workspaces',
  database: {db, migrationsPath},
  auth: [createApiKeyAuthMethod()],
  routes: workspacesRoutes,
};
