import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {emailVerifications} from './schema/email-verifications.js';
import {passwordResets} from './schema/password-resets.js';
import {refreshTokens} from './schema/refresh-tokens.js';
import {users} from './schema/users.js';

export const schema = {
  users,
  passwordResets,
  refreshTokens,
  emailVerifications,
};

let _db: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}
