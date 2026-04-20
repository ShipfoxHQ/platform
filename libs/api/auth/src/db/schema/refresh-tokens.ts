import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {RefreshToken} from '#core/entities/refresh-token.js';
import {pgTable} from './common.js';
import {users} from './users.js';

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuidv7PrimaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {onDelete: 'cascade'}),
    hashedToken: text('hashed_token').notNull(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    revokedAt: timestamp('revoked_at', {withTimezone: true}),
    lastUsedAt: timestamp('last_used_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_refresh_tokens_hashed_token_unique').on(table.hashedToken),
    index('auth_refresh_tokens_user_id_idx').on(table.userId),
  ],
);

export type RefreshTokenDb = typeof refreshTokens.$inferSelect;
export type RefreshTokenCreateDb = typeof refreshTokens.$inferInsert;

export function toRefreshToken(row: RefreshTokenDb): RefreshToken {
  return {
    id: row.id,
    userId: row.userId,
    hashedToken: row.hashedToken,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
