import {text, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

/**
 * Per-workspace session-artifact data-encryption keys, wrapped by the session
 * KEK. The transcript store is a secondary secrets store, so it owns its own
 * wrapped-DEK rows under the agent namespace instead of reading the secrets
 * module's `secret_data_keys` (database ownership boundary).
 */
export interface SessionDataKey {
  workspaceId: string;
  wrappedDek: string;
  kekVersion: string;
  createdAt: Date;
  rotatedAt: Date | null;
}

export const sessionDataKeys = pgTable('data_keys', {
  workspaceId: uuid('workspace_id').primaryKey(),
  wrappedDek: text('wrapped_dek').notNull(),
  kekVersion: text('kek_version').notNull(),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  rotatedAt: timestamp('rotated_at', {withTimezone: true}),
});

export type SessionDataKeyDb = typeof sessionDataKeys.$inferSelect;

export function toSessionDataKey(row: SessionDataKeyDb): SessionDataKey {
  return {
    workspaceId: row.workspaceId,
    wrappedDek: row.wrappedDek,
    kekVersion: row.kekVersion,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt,
  };
}
