import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {agentWorkspaceSettings} from './schema/agent-workspace-settings.js';
import {modelProviderConfigs} from './schema/model-provider-configs.js';
import {sessions} from './schema/sessions.js';

export const schema = {
  modelProviderConfigs,
  agentWorkspaceSettings,
  sessions,
};

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

let _db: Database | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
