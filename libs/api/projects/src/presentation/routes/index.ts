import type {IntegrationSourceControlService} from '@shipfox/api-integration-core';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createProjectRoute} from './create-project.js';
import {getProjectRoute} from './get-project.js';
import {listProjectsRoute} from './list-projects.js';

export function createProjectRoutes(sourceControl: IntegrationSourceControlService): RouteGroup[] {
  return [
    {
      prefix: '/projects',
      routes: [createProjectRoute(sourceControl), listProjectsRoute, getProjectRoute],
    },
  ];
}
