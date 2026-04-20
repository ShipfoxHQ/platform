import type {RouteDefinition} from '@shipfox/node-fastify';
import {getWorkspaceRoute} from './get.js';

export {createWorkspaceRoute} from './create.js';
export {listUserWorkspacesRoute} from './list.js';

export const workspaceRoutes: RouteDefinition[] = [getWorkspaceRoute];
