import {authModule} from '@shipfox/api-auth';
import {definitionsModule} from '@shipfox/api-definitions';
import {dispatcherModule} from '@shipfox/api-dispatcher';
import {integrationsModule} from '@shipfox/api-integration-core';
import {projectsModule} from '@shipfox/api-projects';
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

export async function run(): Promise<void> {
  await startInstanceInstrumentation({
    serviceName: 'api',
    instrumentations: {fastify: true, http: true, pg: true},
  });
  startServiceMetrics({serviceName: 'api'});

  createPostgresClient();

  const {auth, routes, workers} = await initializeModules({
    modules: [
      authModule,
      workspacesModule,
      integrationsModule,
      projectsModule,
      definitionsModule,
      workflowsModule,
      runnersModule,
      dispatcherModule,
    ],
  });

  logger().info('Creating HTTP server');
  await createApp({auth, routes});
  logger().info('Starting HTTP server');
  const address = await listen();
  logger().info({address}, 'HTTP server listening');

  startModuleWorkers({workers});
}
