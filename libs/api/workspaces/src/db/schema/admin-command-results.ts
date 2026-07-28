import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {jsonb, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export interface StoredWorkspaceAdministrationResult {
  workspaceId: string;
  status: 'active' | 'suspended';
  correlationId: string;
}

export const workspacesAdminCommandResults = pgTable(
  'admin_command_results',
  {
    id: uuidv7PrimaryKey(),
    actorId: uuid('actor_id').notNull(),
    idempotencyKeyFingerprint: text('idempotency_key_fingerprint').notNull(),
    command: text('command').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    result: jsonb('result').$type<StoredWorkspaceAdministrationResult>().notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workspaces_admin_command_results_actor_key_unique').on(
      table.actorId,
      table.idempotencyKeyFingerprint,
    ),
  ],
);

export type WorkspaceAdminCommandResultDb = typeof workspacesAdminCommandResults.$inferSelect;
