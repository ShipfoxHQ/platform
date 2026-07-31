import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {administrationActionEventSchemas} from '@shipfox/api-common-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {
  WORKSPACES_INVITATION_SEND_REQUESTED,
  type WorkspacesEventMap,
  workspacesEventSchemas,
} from '@shipfox/api-workspaces-dto';
import type {ShipfoxModule} from '@shipfox/node-module';
import {subscriberFactory} from '@shipfox/node-module';
import {db, migrationsPath, workspacesOutbox} from '#db/index.js';
import {registerWorkspacesServiceMetrics} from '#metrics/index.js';
import {workspacesE2eRoutes} from '#presentation/e2eRoutes/index.js';
import {createWorkspacesInterModulePresentation} from '#presentation/inter-module.js';
import {createWorkspacesRoutes, workspacesRoutes} from '#presentation/routes/index.js';
import {onInvitationSendRequested} from '#presentation/subscribers/index.js';

export type {Invitation} from '#core/entities/invitation.js';
export type {Membership} from '#core/entities/membership.js';
export type {Workspace, WorkspaceStatus} from '#core/entities/workspace.js';
export {
  InvitationEmailMismatchError,
  TokenAlreadyUsedError,
  TokenExpiredError,
  TokenInvalidError,
  WorkspaceNotFoundError,
  WorkspaceSlugConflictError,
} from '#core/errors.js';
export {
  acceptWorkspaceInvitation,
  peekInvitationByRawToken,
  reconcileWorkspaceInvitationAcceptance,
  type WorkspaceInvitationReconciliation,
} from '#core/invitations.js';
export {type EnsureMembershipParams, ensureMembership} from '#core/memberships.js';
export {getWorkspace, requireWorkspaceMembership} from '#core/workspaces.js';
export {db, migrationsPath} from '#db/index.js';
export {listMembershipsByUser} from '#db/memberships.js';
export {createWorkspacesRoutes, workspacesRoutes as routes} from '#presentation/routes/index.js';

const subscriber = subscriberFactory<WorkspacesEventMap>();
const workspacesPublisherEventSchemas = {
  ...workspacesEventSchemas,
  ...administrationActionEventSchemas,
};

export interface WorkspacesModuleOptions {
  auth: AuthInterModuleClient;
  projects: ProjectsModuleClient;
  runners: RunnersInterModuleClient;
}

export function createWorkspacesModule(options: WorkspacesModuleOptions): ShipfoxModule {
  return {
    name: 'workspaces',
    database: {db, migrationsPath, databaseNamespace: 'workspaces'},
    routes: createWorkspacesRoutes(options),
    e2eRoutes: [workspacesE2eRoutes],
    publishers: [
      {
        name: 'workspaces',
        table: workspacesOutbox,
        db,
        eventSchemas: workspacesPublisherEventSchemas,
      },
    ],
    subscribers: [subscriber(WORKSPACES_INVITATION_SEND_REQUESTED, onInvitationSendRequested)],
    metrics: registerWorkspacesServiceMetrics,
    interModulePresentations: [createWorkspacesInterModulePresentation()],
  };
}

/** @deprecated Use createWorkspacesModule from the application composition root. */
export const workspacesModule: ShipfoxModule = {
  name: 'workspaces',
  database: {db, migrationsPath, databaseNamespace: 'workspaces'},
  routes: workspacesRoutes,
  e2eRoutes: [workspacesE2eRoutes],
  publishers: [
    {
      name: 'workspaces',
      table: workspacesOutbox,
      db,
      eventSchemas: workspacesPublisherEventSchemas,
    },
  ],
  subscribers: [subscriber(WORKSPACES_INVITATION_SEND_REQUESTED, onInvitationSendRequested)],
  metrics: registerWorkspacesServiceMetrics,
  interModulePresentations: [createWorkspacesInterModulePresentation()],
};
