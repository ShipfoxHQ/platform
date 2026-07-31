import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createAdminWorkspacesRoutes} from './admin-workspaces.js';
import {invitationsAcceptGroup, invitationsWorkspaceScopedRoutes} from './invitations/index.js';
import {memberRoutes} from './members/index.js';
import {
  createWorkspaceRoute,
  listUserWorkspacesRoute,
  updateWorkspaceRoute,
  workspaceSlugAvailabilityRoute,
} from './workspaces/index.js';

export const workspacesRoutes: RouteGroup[] = [
  invitationsAcceptGroup,
  {
    prefix: '/workspaces',
    routes: [
      listUserWorkspacesRoute,
      createWorkspaceRoute,
      workspaceSlugAvailabilityRoute,
      updateWorkspaceRoute,
      {
        prefix: '/:workspaceId/members',
        routes: memberRoutes,
      },
      {
        prefix: '/:workspaceId/invitations',
        routes: invitationsWorkspaceScopedRoutes,
      },
    ],
  },
];

export function createWorkspacesRoutes(params: {
  auth: AuthInterModuleClient;
  projects: ProjectsModuleClient;
  runners: RunnersInterModuleClient;
}): RouteGroup[] {
  return [...workspacesRoutes, createAdminWorkspacesRoutes(params)];
}
