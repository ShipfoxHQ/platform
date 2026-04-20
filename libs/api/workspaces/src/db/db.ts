import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {apiKeys} from './schema/api-keys.js';
import {invitations} from './schema/invitations.js';
import {memberships} from './schema/memberships.js';
import {workspaces} from './schema/workspaces.js';

export const schema = {
  workspaces,
  apiKeys,
  memberships,
  invitations,
};

let _db: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
