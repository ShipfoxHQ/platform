import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {integrationConnections} from './schema/connections.js';
import {integrationsOutbox} from './schema/outbox.js';
import {integrationSecretCleanups} from './schema/secret-cleanups.js';
import {integrationsWebhookDeliveries} from './schema/webhook-deliveries.js';

export const schema = {
  integrationConnections,
  integrationSecretCleanups,
  integrationsOutbox,
  integrationsWebhookDeliveries,
};

let _db: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
