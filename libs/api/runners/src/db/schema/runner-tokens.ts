import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {RunnerToken} from '#core/entities/runner-token.js';
import {pgTable} from './common.js';

export const runnerTokens = pgTable(
  'runner_tokens',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    hashedToken: text('hashed_token').notNull(),
    prefix: text('prefix').notNull(),
    name: text('name'),
    expiresAt: timestamp('expires_at', {withTimezone: true}),
    revokedAt: timestamp('revoked_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('runners_runner_tokens_hashed_token_unique').on(table.hashedToken),
    index('runners_runner_tokens_workspace_id_idx').on(table.workspaceId),
    index('runners_runner_tokens_active_lookup_idx').on(
      table.hashedToken,
      table.revokedAt,
      table.expiresAt,
    ),
  ],
);

export type RunnerTokenDb = typeof runnerTokens.$inferSelect;
export type RunnerTokenInsertDb = typeof runnerTokens.$inferInsert;

export function toRunnerToken(row: RunnerTokenDb): RunnerToken {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    hashedToken: row.hashedToken,
    prefix: row.prefix,
    name: row.name,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
