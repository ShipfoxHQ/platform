import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {ApiKey} from '#core/entities/api-key.js';
import {pgTable} from './common.js';
import {workspaces} from './workspaces.js';

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    hashedKey: text('hashed_key').notNull(),
    prefix: text('prefix').notNull(),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    expiresAt: timestamp('expires_at', {withTimezone: true}),
    revokedAt: timestamp('revoked_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workspaces_api_keys_hashed_key_unique').on(table.hashedKey),
    index('workspaces_api_keys_workspace_id_idx').on(table.workspaceId),
  ],
);

export type ApiKeyDb = typeof apiKeys.$inferSelect;
export type ApiKeyCreateDb = typeof apiKeys.$inferInsert;

export function toApiKey(row: ApiKeyDb): ApiKey {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    hashedKey: row.hashedKey,
    prefix: row.prefix,
    scopes: row.scopes,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
