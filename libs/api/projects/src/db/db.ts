import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {projectsOutbox} from './schema/outbox.js';
import {projects} from './schema/projects.js';
import {repositories} from './schema/repositories.js';
import {vcsConnections} from './schema/vcs-connections.js';

export const schema = {
  vcsConnections,
  repositories,
  projects,
  projectsOutbox,
};

let _db: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
