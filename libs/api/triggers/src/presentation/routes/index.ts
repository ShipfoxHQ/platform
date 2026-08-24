import {AUTH_USER} from '@shipfox/api-auth-context';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createDevRunRoute} from './create-dev-run.js';
import {createFireManualTriggerRoute} from './fire-manual.js';
import {getTriggerEventRoute} from './get-trigger-event.js';
import {listTriggerEventFacetsRoute} from './list-trigger-event-facets.js';
import {listTriggerEventsRoute} from './list-trigger-events.js';

export function createTriggerRoutes(
  workflows: WorkflowsModuleClient,
  definitions: DefinitionsInterModuleClient,
  projects: ProjectsModuleClient,
): RouteGroup[] {
  return [
    {
      prefix: '/workflow-definitions',
      auth: AUTH_USER,
      routes: [createFireManualTriggerRoute(workflows)],
    },
    {
      prefix: '/dev-runs',
      auth: AUTH_USER,
      routes: [createDevRunRoute(workflows, definitions, projects)],
    },
    {
      // The static /facets path is matched ahead of the /:id detail route by Fastify's
      // radix router, so registration order does not affect resolution.
      prefix: '/trigger-events',
      auth: AUTH_USER,
      routes: [listTriggerEventFacetsRoute, listTriggerEventsRoute, getTriggerEventRoute],
    },
  ];
}
