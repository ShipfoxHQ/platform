import type {AuthMethod, RouteExport} from '@shipfox/node-fastify';
import type {DomainEvent, OutboxTable} from '@shipfox/node-outbox';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';

export interface ModuleDatabase {
  db: () => NodePgDatabase<Record<string, unknown>>;
  migrationsPath: string;
}

export interface ModulePublisher {
  name: string;
  table: OutboxTable;
  db: () => NodePgDatabase<Record<string, unknown>>;
}

export interface ModuleSubscriber {
  event: string;
  handler: (event: DomainEvent) => Promise<void>;
}

export interface WorkflowStart {
  name: string;
  id: string;
}

export interface ModuleWorker {
  taskQueue: string;
  workflowsPath: string;
  activities: () => object;
  workflows: WorkflowStart[];
}

export interface ShipfoxModule {
  name: string;
  database?: ModuleDatabase | ModuleDatabase[];
  auth?: AuthMethod[];
  routes?: RouteExport[];
  e2eRoutes?: RouteExport[];
  publishers?: ModulePublisher[];
  subscribers?: ModuleSubscriber[];
  workers?: ModuleWorker[];
}
