import {authModule} from '@shipfox/api-auth';
import {definitionsModule} from '@shipfox/api-definitions';
import {dispatcherModule} from '@shipfox/api-dispatcher';
import {createIntegrationsContext} from '@shipfox/api-integration-core';
import {createProjectsModule} from '@shipfox/api-projects';
import {runnersModule} from '@shipfox/api-runners';
import {workflowsModule} from '@shipfox/api-workflows';
import {workspacesModule} from '@shipfox/api-workspaces';
import {createApp, listen} from '@shipfox/node-fastify';
import {initializeModules, startModuleWorkers} from '@shipfox/node-module';
import {
  logger,
  startInstanceInstrumentation,
  startServiceMetrics,
} from '@shipfox/node-opentelemetry';
import {createPostgresClient} from '@shipfox/node-postgres';
import {config} from '../config.js';
import {createE2eAdminAuthMethod, createE2eRouteGroup} from './e2e.js';

export async function run(): Promise<void> {
  await startInstanceInstrumentation({
    serviceName: 'api',
    instrumentations: {fastify: true, http: true, pg: true},
  });
  startServiceMetrics({serviceName: 'api'});

  createPostgresClient();

  const integrations = createIntegrationsContext();
  const projectsModule = createProjectsModule({sourceControl: integrations.sourceControl});

  const {auth, routes, e2eRoutes, workers} = await initializeModules({
    modules: [
      authModule,
      workspacesModule,
      integrations.module,
      projectsModule,
      definitionsModule,
      workflowsModule,
      runnersModule,
      dispatcherModule,
    ],
  });
  const e2eAuth = config.E2E_ENABLED ? [createE2eAdminAuthMethod(config)] : [];
  const mountedE2eRoutes = createE2eRouteGroup(e2eRoutes, config);

  logger().info('Creating HTTP server');
  await createApp({auth: [...auth, ...e2eAuth], routes: [...routes, ...mountedE2eRoutes]});
  logger().info('Starting HTTP server');
  const address = await listen();
  logger().info({address}, 'HTTP server listening');

  startModuleWorkers({workers});
}
