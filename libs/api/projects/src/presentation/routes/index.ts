import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createAdminProjectsRoute} from './admin-projects.js';
import {createProjectRoute} from './create-project.js';
import {getProjectRoute} from './get-project.js';
import {listProjectsRoute} from './list-projects.js';

export function createProjectRoutes(
  integrations: IntegrationsModuleClient,
  auth: Pick<AuthInterModuleClient, 'requireAdminRole'>,
): RouteGroup[] {
  return [
    {
      prefix: '/projects',
      routes: [createProjectRoute(integrations), listProjectsRoute, getProjectRoute],
    },
    {
      prefix: '/admin/projects',
      routes: [createAdminProjectsRoute(auth)],
    },
  ];
}
