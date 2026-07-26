import type {AdminRole} from '@shipfox/api-auth-dto';
import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {jsonb, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';
import {users} from './users.js';

export interface StoredAdminGrant {
  id: string;
  userId: string;
  role: AdminRole;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAdminCommandResult {
  grant: StoredAdminGrant;
}

export const adminCommandResults = pgTable(
  'admin_command_results',
  {
    id: uuidv7PrimaryKey(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, {onDelete: 'cascade'}),
    idempotencyKeyFingerprint: text('idempotency_key_fingerprint').notNull(),
    command: text('command').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    result: jsonb('result').$type<StoredAdminCommandResult>().notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_admin_command_results_actor_key_unique').on(
      table.actorId,
      table.idempotencyKeyFingerprint,
    ),
  ],
);

export type AdminCommandResultDb = typeof adminCommandResults.$inferSelect;
