import type {InterModulePresentation} from '@shipfox/inter-module';
import type {AuthMethod, RouteExport} from '@shipfox/node-fastify';
import type {OutboxTable} from '@shipfox/node-outbox';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import type {ZodType} from 'zod';
import type {OutboxRegistry} from './publisher-registry.js';
import type {ModuleSubscriber} from './subscriber.js';

export interface ModuleDatabase {
  db: () => NodePgDatabase<Record<string, unknown>>;
  migrationsPath: string;
  /**
   * Stable database identity used for table prefixes and the Drizzle
   * migration-tracking table. This is registered independently of the module's
   * display name and must remain stable when modules or providers are moved,
   * reordered, enabled, or disabled.
   */
  databaseNamespace: string;
}

export interface ModulePublisher {
  name: string;
  table: OutboxTable;
  db: () => NodePgDatabase<Record<string, unknown>>;
  /**
   * Optional schemas for events this publisher writes. Omitted entries preserve
   * the historical unchecked payload path; new entries should live in the
   * producing module's `*-dto` package so payload types and validation share one
   * contract.
   */
  eventSchemas?: Record<string, ZodType>;
}

export interface WorkflowStart {
  name: string;
  id: string;
  args?: unknown[];
  /**
   * Optional Temporal cron expression (e.g. `* * * * *`). When set, the
   * workflow is started with `cronSchedule` so Temporal handles recurrence
   * natively: no continueAsNew loop or external scheduler needed.
   */
  cronSchedule?: string;
}

export interface ModuleWorker {
  /** Populated automatically from the declaring Shipfox module. */
  moduleName?: string;
  taskQueue: string;
  workflowsPath: string;
  activities: (context: ModuleRuntimeContext) => object;
  workflows: WorkflowStart[];
}

export interface ModuleRuntimeContext {
  outboxRegistry: OutboxRegistry;
}

export interface ModuleServiceHandle {
  stop(): Promise<void>;
  finished: Promise<void>;
}

export interface ModuleService {
  name: string;
  shutdownTimeoutMs: number;
  start(context: ModuleRuntimeContext): Promise<ModuleServiceHandle>;
}

/**
 * Hook for observable gauges over shared service state. Implementations must
 * fetch the service metrics provider inside the callback so ordinary module
 * imports do not bind the metrics port.
 */
export type ModuleMetricsRegistration = (context: ModuleRuntimeContext) => void;

export type ModuleStartupTasks = (context: ModuleRuntimeContext) => Promise<void>;

/**
 * A user-facing mechanism that establishes a standard Shipfox session.
 * This is distinct from an `AuthMethod`, which authenticates requests after a
 * session has been established.
 */
export interface LoginMethod {
  id: string;
}

export interface ShipfoxModule {
  name: string;
  database?: ModuleDatabase | ModuleDatabase[];
  auth?: AuthMethod[];
  loginMethods?: LoginMethod[];
  routes?: RouteExport[];
  e2eRoutes?: RouteExport[];
  publishers?: ModulePublisher[];
  subscribers?: ModuleSubscriber[];
  workers?: ModuleWorker[];
  services?: ModuleService[];
  metrics?: ModuleMetricsRegistration;
  startupTasks?: ModuleStartupTasks;
  /**
   * Producer presentations this module registers on the application's
   * inter-module transport. Typed against each contract at the module factory
   * boundary; erased here because one module array holds every context's
   * presentations. `registerInterModulePresentations` recovers runtime safety
   * by validating each one against the transport it registers into.
   */
  interModulePresentations?: InterModulePresentation[];
}
