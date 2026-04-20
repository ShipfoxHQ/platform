import type {RouteDefinition, RouteGroup} from '@shipfox/node-fastify';
import {acceptInvitationRoute} from './accept.js';
import {createInvitationRoute} from './create.js';
import {listInvitationsRoute} from './list.js';
import {revokeInvitationRoute} from './revoke.js';

export const invitationsWorkspaceScopedRoutes: RouteDefinition[] = [
  createInvitationRoute,
  listInvitationsRoute,
  revokeInvitationRoute,
];

export const invitationsAcceptGroup: RouteGroup = {
  prefix: '/invitations',
  routes: [acceptInvitationRoute],
};
