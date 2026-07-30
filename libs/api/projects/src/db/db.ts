import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {projectsIntegrationEventDedup} from './schema/integration-event-dedup.js';
import {projectsOutbox} from './schema/outbox.js';
import {projects} from './schema/projects.js';

export const schema = {
  projects,
  projectsOutbox,
  projectsIntegrationEventDedup,
};

let _db: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];
export type Executor = ReturnType<typeof db> | Tx;

export function closeDb(): void {
  _db = undefined;
}
