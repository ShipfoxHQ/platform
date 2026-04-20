import {AUTH_API_KEY} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {apiKeyRoutes} from './api-keys/index.js';
import {invitationsAcceptGroup, invitationsWorkspaceScopedRoutes} from './invitations/index.js';
import {memberRoutes} from './members/index.js';
import {
  createWorkspaceRoute,
  listUserWorkspacesRoute,
  workspaceRoutes,
} from './workspaces/index.js';

export const workspacesRoutes: RouteGroup[] = [
  invitationsAcceptGroup,
  {
    prefix: '/workspaces',
    routes: [
      listUserWorkspacesRoute,
      createWorkspaceRoute,
      {
        prefix: '/:workspaceId',
        auth: AUTH_API_KEY,
        routes: [
          ...workspaceRoutes,
          {
            prefix: '/api-keys',
            routes: apiKeyRoutes,
          },
        ],
      },
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
