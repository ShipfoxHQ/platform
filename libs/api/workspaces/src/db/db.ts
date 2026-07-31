import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {workspacesAdminCommandResults} from './schema/admin-command-results.js';
import {invitations} from './schema/invitations.js';
import {memberships} from './schema/memberships.js';
import {workspacesOutbox} from './schema/outbox.js';
import {workspacesRateLimits} from './schema/rate-limits.js';
import {workspaces} from './schema/workspaces.js';

export const schema = {
  workspacesAdminCommandResults,
  workspaces,
  memberships,
  invitations,
  workspacesOutbox,
  workspacesRateLimits,
};

let _db: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
