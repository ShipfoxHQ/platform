import {runMigrations} from '@shipfox/node-drizzle';
import type {AuthMethod, RouteExport} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {createTemporalClient, createTemporalWorker, temporalClient} from '@shipfox/node-temporal';
import {registerPublisher} from './publisher-registry.js';
import {subscribe} from './registry.js';
import type {ModuleDatabase, ModuleWorker, ShipfoxModule} from './types.js';

export interface InitializeModulesOptions {
  modules: ShipfoxModule[];
}

export interface InitializedModules {
  auth: AuthMethod[];
  routes: RouteExport[];
  e2eRoutes: RouteExport[];
  workers: ModuleWorker[];
}

/**
 * Initializes modules in array order. Modules are processed sequentially
 * so migration order is deterministic — list modules with shared dependencies first.
 *
 * Publishers and subscribers declared on each module are registered automatically
 * into the shared pub/sub registry.
 */
export async function initializeModules(
  options: InitializeModulesOptions,
): Promise<InitializedModules> {
  const auth: AuthMethod[] = [];
  const routes: RouteExport[] = [];
  const e2eRoutes: RouteExport[] = [];
  const workers: ModuleWorker[] = [];

  for (const mod of options.modules) {
    logger().info({module: mod.name}, 'Initializing module');

    if (mod.database) {
      const databases = normalizeModuleDatabases(mod.database);
      for (const [index, database] of databases.entries()) {
        logger().info({module: mod.name, database: index}, 'Running migrations');
        await runMigrations(
          database.db(),
          database.migrationsPath,
          moduleMigrationTableName(mod.name, index),
        );
        logger().info({module: mod.name, database: index}, 'Migrations complete');
      }
    }

    if (mod.publishers) {
      for (const pub of mod.publishers) {
        registerPublisher(pub);
      }
    }

    if (mod.subscribers) {
      for (const sub of mod.subscribers) {
        subscribe(sub.event, sub.handler);
      }
    }

    if (mod.auth) {
      auth.push(...mod.auth);
    }

    if (mod.routes) {
      routes.push(...mod.routes);
    }

    if (mod.e2eRoutes) {
      e2eRoutes.push(...mod.e2eRoutes);
    }

    if (mod.workers) {
      workers.push(...mod.workers);
    }

    logger().info({module: mod.name}, 'Module initialized');
  }

  return {auth, routes, e2eRoutes, workers};
}

function normalizeModuleDatabases(database: ModuleDatabase | ModuleDatabase[]): ModuleDatabase[] {
  return Array.isArray(database) ? database : [database];
}

function moduleMigrationTableName(moduleName: string, index: number): string {
  if (index === 0) return `__drizzle_migrations_${moduleName}`;
  return `__drizzle_migrations_${moduleName}_${index}`;
}

/**
 * Creates Temporal workers for all module-declared workers and starts their workflows.
 * Call this after `initializeModules` so that all publishers/subscribers are registered.
 */
export async function startModuleWorkers(options: {workers: ModuleWorker[]}): Promise<void> {
  if (options.workers.length === 0) return;

  await createTemporalClient();

  for (const workerDef of options.workers) {
    try {
      const worker = await createTemporalWorker({
        taskQueue: workerDef.taskQueue,
        workflowsPath: workerDef.workflowsPath,
        activities: workerDef.activities(),
      });

      for (const workflow of workerDef.workflows) {
        try {
          await temporalClient().workflow.start(workflow.name, {
            taskQueue: workerDef.taskQueue,
            workflowId: workflow.id,
          });
        } catch (error) {
          if (error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError') {
            logger().info({workflowId: workflow.id}, 'Workflow already running, skipping start');
          } else {
            throw error;
          }
        }
      }

      worker.run().catch((error) => {
        logger().error({err: error, taskQueue: workerDef.taskQueue}, 'Worker stopped unexpectedly');
      });

      logger().info({taskQueue: workerDef.taskQueue}, 'Module worker started');
    } catch (error) {
      logger().warn(
        {err: error, taskQueue: workerDef.taskQueue},
        'Failed to start module worker, will retry on next restart',
      );
    }
  }
}
