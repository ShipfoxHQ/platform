import type {RouteDefinition} from '@shipfox/node-fastify';
import {listMembersRoute} from './list.js';
import {removeMemberRoute} from './remove.js';

export const memberRoutes: RouteDefinition[] = [listMembersRoute, removeMemberRoute];
