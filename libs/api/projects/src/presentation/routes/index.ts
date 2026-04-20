import type {RouteGroup} from '@shipfox/node-fastify';
import {createProjectRoute} from './create-project.js';
import {createVcsConnectionRoute} from './create-vcs-connection.js';
import {getProjectRoute} from './get-project.js';
import {listProjectsRoute} from './list-projects.js';

export const projectRoutes: RouteGroup[] = [
  {
    prefix: '/projects',
    routes: [createProjectRoute, listProjectsRoute, getProjectRoute],
  },
  {
    prefix: '',
    routes: [createVcsConnectionRoute],
  },
];
