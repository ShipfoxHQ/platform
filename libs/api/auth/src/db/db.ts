import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {adminCommandResults} from './schema/admin-command-results.js';
import {adminGrants} from './schema/admin-grants.js';
import {
  agentAuthorizationCodes,
  agentAuthorizationRequests,
  agentClients,
  agentGrants,
  agentRefreshTokens,
} from './schema/agent-access.js';
import {authOutbox} from './schema/outbox.js';
import {passwordResets} from './schema/password-resets.js';
import {authRateLimits} from './schema/rate-limits.js';
import {refreshTokens} from './schema/refresh-tokens.js';
import {users} from './schema/users.js';

export const schema = {
  adminGrants,
  agentClients,
  agentAuthorizationRequests,
  agentGrants,
  agentAuthorizationCodes,
  agentRefreshTokens,
  adminCommandResults,
  users,
  passwordResets,
  refreshTokens,
  authOutbox,
  authRateLimits,
};

let _db: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
