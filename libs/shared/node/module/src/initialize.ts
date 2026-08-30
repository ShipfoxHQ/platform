import {runMigrations} from '@shipfox/node-drizzle';
import {markErrorReported, reportError} from '@shipfox/node-error-monitoring';
import type {AuthMethod, RouteExport} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {
  closeTemporalClient,
  createTemporalClient,
  createTemporalWorker,
  createTemporalWorkerConnection,
  type NativeConnection,
  temporalClient,
  type Worker,
} from '@shipfox/node-temporal';
import {instrumentModuleActivities} from './metrics.js';
import {createOutboxRegistry, registerPublisher, subscribe} from './publisher-registry.js';
import type {
  ModuleDatabase,
  ModuleRuntimeContext,
  ModuleService,
  ModuleServiceHandle,
  ModuleWorker,
  ShipfoxModule,
} from './types.js';

export interface InitializeModulesOptions {
  modules: ShipfoxModule[];
}

const databaseNamespaceExpression = /^[a-z][a-z0-9_]*$/u;

export interface InitializedModules {
  auth: AuthMethod[];
  routes: RouteExport[];
  e2eRoutes: RouteExport[];
  workers: ModuleWorker[];
  services: ModuleService[];
  outboxRegistry: ModuleRuntimeContext['outboxRegistry'];
}

export interface StartModuleWorkersOptions {
  workers: ModuleWorker[];
  context: ModuleRuntimeContext;
  onWorkerFailure?: (error: unknown, worker: ModuleWorker) => void | Promise<void>;
}

export interface ModuleWorkersHandle {
  stop(): Promise<void>;
}

export interface StartModuleServicesOptions {
  services: ModuleService[];
  context: ModuleRuntimeContext;
  onServiceFailure?: (error: unknown, service: ModuleService) => void | Promise<void>;
}

export interface ModuleServicesHandle {
  stop(): Promise<void>;
}

interface StartedModuleWorker {
  worker: Worker;
  taskQueue: string;
  runPromise?: Promise<void>;
}

interface StartedModuleService {
  definition: ModuleService;
  handle: ModuleServiceHandle;
}

type ModuleInitializationState = InitializedModules;

/**
 * Initializes modules in array order. Modules are processed sequentially
 * so migration order is deterministic: list modules with shared dependencies first.
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
  const services: ModuleService[] = [];
  const outboxRegistry = createOutboxRegistry();

  validateModuleDatabaseNamespaces(options.modules);

  for (const mod of options.modules) {
    await initializeModule(mod, {auth, routes, e2eRoutes, workers, services, outboxRegistry});
  }

  return {auth, routes, e2eRoutes, workers, services, outboxRegistry};
}

async function initializeModule(
  mod: ShipfoxModule,
  state: ModuleInitializationState,
): Promise<void> {
  logger().info({module: mod.name}, 'Initializing module');
  await initializeModuleDatabases(mod);
  registerModuleMessaging(mod, state.outboxRegistry);
  collectModuleExports(mod, state);
  logger().info({module: mod.name}, 'Module initialized');
}

async function initializeModuleDatabases(mod: ShipfoxModule): Promise<void> {
  if (!mod.database) return;
  for (const database of normalizeModuleDatabases(mod.database)) {
    logger().info({module: mod.name, database: database.databaseNamespace}, 'Running migrations');
    await runMigrations(
      database.db(),
      database.migrationsPath,
      migrationHistoryTableName(database.databaseNamespace),
    );
    logger().info({module: mod.name, database: database.databaseNamespace}, 'Migrations complete');
  }
}

function registerModuleMessaging(
  mod: ShipfoxModule,
  outboxRegistry: ModuleRuntimeContext['outboxRegistry'],
): void {
  for (const publisher of mod.publishers ?? []) registerPublisher(outboxRegistry, publisher);
  for (const subscriber of mod.subscribers ?? []) {
    subscribe(outboxRegistry, subscriber.event, subscriber.handler);
  }
}

function collectModuleExports(mod: ShipfoxModule, state: ModuleInitializationState): void {
  if (mod.auth) state.auth.push(...mod.auth);
  if (mod.routes) state.routes.push(...mod.routes);
  if (mod.e2eRoutes) state.e2eRoutes.push(...mod.e2eRoutes);
  if (mod.workers) {
    state.workers.push(...mod.workers.map((worker) => ({...worker, moduleName: mod.name})));
  }
  if (mod.services) state.services.push(...mod.services);
}

function normalizeModuleDatabases(database: ModuleDatabase | ModuleDatabase[]): ModuleDatabase[] {
  return Array.isArray(database) ? database : [database];
}

function validateModuleDatabaseNamespaces(modules: readonly ShipfoxModule[]): void {
  const owners = new Map<string, string>();

  for (const mod of modules) {
    if (!mod.database) continue;
    for (const database of normalizeModuleDatabases(mod.database)) {
      const {databaseNamespace} = database;
      if (!databaseNamespaceExpression.test(databaseNamespace)) {
        throw new Error(
          `Invalid database namespace "${databaseNamespace}" declared by module "${mod.name}"; expected lowercase snake case`,
        );
      }

      const existingOwner = owners.get(databaseNamespace);
      if (existingOwner) {
        throw new Error(
          `Duplicate database namespace "${databaseNamespace}" declared by modules "${existingOwner}" and "${mod.name}"`,
        );
      }
      owners.set(databaseNamespace, mod.name);
    }
  }
}

function migrationHistoryTableName(databaseNamespace: string): string {
  return `__drizzle_migrations_${databaseNamespace}`;
}

/**
 * Service metrics must register after the app starts the service metrics
 * provider and initializes modules. Keeping this separate prevents tests that
 * import modules from binding the metrics port, and isolates registration
 * failures from the boot path.
 */
export function registerModuleMetrics(options: {
  modules: ShipfoxModule[];
  context: ModuleRuntimeContext;
}): void {
  for (const mod of options.modules) {
    if (!mod.metrics) continue;
    try {
      logger().info({module: mod.name}, 'Registering module metrics');
      mod.metrics(options.context);
    } catch (error) {
      logger().warn({err: error, module: mod.name}, 'Failed to register module metrics');
      reportError(error, {boundary: 'module.metrics', tags: {module: mod.name}});
    }
  }
}

export async function runModuleStartupTasks(options: {
  modules: ShipfoxModule[];
  context: ModuleRuntimeContext;
}): Promise<void> {
  for (const mod of options.modules) {
    await mod.startupTasks?.(options.context);
  }
}

export async function startModuleServices(
  options: StartModuleServicesOptions,
): Promise<ModuleServicesHandle> {
  if (options.services.length === 0) return {stop: async () => undefined};

  const services: StartedModuleService[] = [];
  let stopping = false;
  let stopPromise: Promise<void> | undefined;

  try {
    for (const definition of options.services) {
      const handle = await definition.start(options.context);
      const startedService = {definition, handle};
      services.push(startedService);
      observeModuleServiceCompletion({startedService, isStopping: () => stopping, options});
      logger().info({service: definition.name}, 'Module service started');
    }
  } catch (error) {
    stopping = true;
    try {
      await stopStartedModuleServices(services);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Failed to start module services');
    }
    throw error;
  }

  return {
    stop: () => {
      stopping = true;
      stopPromise ??= stopStartedModuleServices(services);
      return stopPromise;
    },
  };
}

function observeModuleServiceCompletion(options: {
  startedService: StartedModuleService;
  isStopping(): boolean;
  options: StartModuleServicesOptions;
}): void {
  const {definition, handle} = options.startedService;
  void handle.finished.then(
    () => {
      if (options.isStopping()) return;
      reportModuleServiceFailure(
        new Error(`Module service ${definition.name} stopped unexpectedly`),
        definition,
        options.options.onServiceFailure,
      );
    },
    (error: unknown) => {
      if (options.isStopping()) return;
      reportModuleServiceFailure(error, definition, options.options.onServiceFailure);
    },
  );
}

function reportModuleServiceFailure(
  error: unknown,
  service: ModuleService,
  onServiceFailure: StartModuleServicesOptions['onServiceFailure'],
): void {
  if (onServiceFailure) {
    void Promise.resolve(onServiceFailure(error, service)).catch((handlerError) => {
      logger().error(
        {err: handlerError, serviceErr: error, service: service.name},
        'Module service failure handler failed',
      );
      reportError(handlerError, {
        boundary: 'module.service',
        operation: 'failure-callback',
        tags: {service: service.name},
      });
    });
    return;
  }
  logger().error({err: error, service: service.name}, 'Module service stopped unexpectedly');
}

async function stopStartedModuleServices(services: StartedModuleService[]): Promise<void> {
  const errors: unknown[] = [];
  for (const service of [...services].reverse()) {
    try {
      await stopModuleService(service);
    } catch (error) {
      logger().error(
        {err: error, service: service.definition.name},
        'Failed to stop module service',
      );
      reportError(error, {
        boundary: 'module.service',
        operation: 'stop',
        tags: {service: service.definition.name},
      });
      errors.push(error);
    }
  }
  throwLifecycleErrors(errors, 'Failed to stop module services');
}

export class ModuleServiceShutdownTimeoutError extends Error {
  constructor(service: string, timeoutMs: number) {
    super(`Timed out stopping module service ${service} after ${timeoutMs}ms`);
    this.name = 'ModuleServiceShutdownTimeoutError';
  }
}

async function stopModuleService(service: StartedModuleService): Promise<void> {
  const stopResult = Promise.resolve()
    .then(() => service.handle.stop())
    .then(
      () => ({status: 'stopped' as const}),
      (error: unknown) => ({status: 'failed' as const, error}),
    );
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{status: 'timed-out'}>((resolve) => {
    timeoutId = setTimeout(
      () => resolve({status: 'timed-out'}),
      service.definition.shutdownTimeoutMs,
    );
  });
  const result = await Promise.race([stopResult, timeout]);
  if (timeoutId) clearTimeout(timeoutId);

  if (result.status === 'stopped') return;
  if (result.status === 'failed') {
    throw result.error;
  }

  const timeoutError = new ModuleServiceShutdownTimeoutError(
    service.definition.name,
    service.definition.shutdownTimeoutMs,
  );
  void stopResult.then((lateResult) => {
    if (lateResult.status !== 'failed') return;
    logger().error(
      {err: lateResult.error, service: service.definition.name},
      'Module service stop failed after timeout',
    );
    reportError(lateResult.error, {
      boundary: 'module.service',
      operation: 'stop-after-timeout',
      tags: {service: service.definition.name},
    });
  });
  throw timeoutError;
}

/**
 * Creates Temporal workers for all module-declared workers and starts their workflows.
 * Call this after `initializeModules` so that all publishers/subscribers are registered.
 */
export async function startModuleWorkers(
  options: StartModuleWorkersOptions,
): Promise<ModuleWorkersHandle> {
  if (options.workers.length === 0) return {stop: async () => undefined};

  await createTemporalClient();
  let connection: NativeConnection | undefined;
  const workers: StartedModuleWorker[] = [];
  let stopping = false;
  let stopPromise: Promise<void> | undefined;

  try {
    connection = await createTemporalWorkerConnection();

    for (const workerDef of options.workers) {
      await startModuleWorker({
        connection,
        workerDef,
        context: options.context,
        onWorkerFailure: options.onWorkerFailure,
        isStopping: () => stopping,
        onWorkerCreated: (startedWorker) => workers.push(startedWorker),
      });
    }
  } catch (error) {
    stopping = true;
    try {
      await cleanUpFailedModuleWorkerStartup({error, workers, connection});
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Failed to start module workers');
    }
    throw error;
  }

  return {
    stop: () => {
      stopping = true;
      stopPromise ??= stopModuleWorkers({workers, connection});
      return stopPromise;
    },
  };
}

async function startModuleWorker(params: {
  connection: NativeConnection;
  workerDef: ModuleWorker;
  context: ModuleRuntimeContext;
  onWorkerFailure: StartModuleWorkersOptions['onWorkerFailure'];
  isStopping(): boolean;
  onWorkerCreated(startedWorker: StartedModuleWorker): void;
}): Promise<void> {
  try {
    const worker = await createTemporalWorker({
      connection: params.connection,
      taskQueue: params.workerDef.taskQueue,
      workflowsPath: params.workerDef.workflowsPath,
      activities: instrumentModuleActivities({
        moduleName: params.workerDef.moduleName ?? 'unknown',
        taskQueue: params.workerDef.taskQueue,
        activities: params.workerDef.activities(params.context),
      }),
    });
    const startedWorker: StartedModuleWorker = {
      worker,
      taskQueue: params.workerDef.taskQueue,
    };
    params.onWorkerCreated(startedWorker);
    await startModuleWorkerWorkflows(params.workerDef);
    startedWorker.runPromise = worker.run();
    monitorModuleWorker(startedWorker, params);
    logger().info({taskQueue: params.workerDef.taskQueue}, 'Module worker started');
  } catch (error) {
    throw new Error(`Failed to start module worker for task queue ${params.workerDef.taskQueue}`, {
      cause: error,
    });
  }
}

async function startModuleWorkerWorkflows(workerDef: ModuleWorker): Promise<void> {
  for (const workflow of workerDef.workflows) {
    try {
      await temporalClient().workflow.start(workflow.name, {
        taskQueue: workerDef.taskQueue,
        workflowId: workflow.id,
        ...(workflow.args ? {args: workflow.args} : {}),
        ...(workflow.cronSchedule ? {cronSchedule: workflow.cronSchedule} : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError') {
        logger().info({workflowId: workflow.id}, 'Workflow already running, skipping start');
        continue;
      }
      throw error;
    }
  }
}

function monitorModuleWorker(
  startedWorker: StartedModuleWorker,
  params: {
    workerDef: ModuleWorker;
    onWorkerFailure: StartModuleWorkersOptions['onWorkerFailure'];
    isStopping(): boolean;
  },
): void {
  startedWorker.runPromise?.catch((error) => {
    if (params.isStopping()) return;
    if (!params.onWorkerFailure) {
      logger().error(
        {err: error, taskQueue: params.workerDef.taskQueue},
        'Worker stopped unexpectedly',
      );
      return;
    }
    void Promise.resolve(params.onWorkerFailure(error, params.workerDef)).catch((handlerError) => {
      logger().error(
        {err: handlerError, workerErr: error, taskQueue: params.workerDef.taskQueue},
        'Module worker failure handler failed',
      );
      reportError(handlerError, {
        boundary: 'module.worker',
        operation: 'failure-callback',
        tags: {taskQueue: params.workerDef.taskQueue},
      });
    });
  });
}

async function stopModuleWorkers(options: {
  workers: StartedModuleWorker[];
  connection: NativeConnection;
}): Promise<void> {
  const errors: unknown[] = [];
  for (const {worker, taskQueue} of options.workers) {
    try {
      worker.shutdown();
    } catch (error) {
      logger().error({err: error, taskQueue}, 'Failed to shut down module worker');
      reportError(error, {
        boundary: 'module.worker',
        operation: 'shutdown',
        tags: {taskQueue},
      });
      errors.push(error);
    }
  }

  const results = await Promise.allSettled(
    options.workers.map(({runPromise}) => runPromise ?? Promise.resolve()),
  );
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      const worker = options.workers[index];
      logger().error(
        {err: result.reason, ...(worker ? {taskQueue: worker.taskQueue} : {})},
        'Module worker stopped with an error',
      );
      reportError(result.reason, {
        boundary: 'module.worker',
        operation: 'run',
        ...(worker ? {tags: {taskQueue: worker.taskQueue}} : {}),
      });
      errors.push(result.reason);
    }
  }

  try {
    await options.connection.close();
  } catch (error) {
    logger().error({err: error}, 'Failed to close module worker connection');
    reportError(error, {boundary: 'module.worker', operation: 'close-connection'});
    errors.push(error);
  } finally {
    try {
      await closeTemporalClient();
    } catch (error) {
      logger().error({err: error}, 'Failed to close module Temporal client');
      reportError(error, {boundary: 'module.worker', operation: 'close-client'});
      errors.push(error);
    }
  }
  throwLifecycleErrors(errors, 'Failed to stop module workers');
}

function throwLifecycleErrors(errors: unknown[], message: string): void {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  const aggregate = new AggregateError(errors, message);
  markErrorReported(aggregate);
  throw aggregate;
}

async function cleanUpFailedModuleWorkerStartup(options: {
  error: unknown;
  workers: StartedModuleWorker[];
  connection: NativeConnection | undefined;
}): Promise<void> {
  if (options.connection) {
    await stopModuleWorkers({workers: options.workers, connection: options.connection});
  } else {
    await closeTemporalClient();
  }
}
