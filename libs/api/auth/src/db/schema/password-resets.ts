import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {PasswordReset} from '#core/entities/password-reset.js';
import {pgTable} from './common.js';
import {users} from './users.js';

export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuidv7PrimaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {onDelete: 'cascade'}),
    hashedToken: text('hashed_token').notNull(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    usedAt: timestamp('used_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_password_resets_hashed_token_unique').on(table.hashedToken),
    index('auth_password_resets_user_id_idx').on(table.userId),
  ],
);

export type PasswordResetDb = typeof passwordResets.$inferSelect;
export type PasswordResetCreateDb = typeof passwordResets.$inferInsert;

export function toPasswordReset(row: PasswordResetDb): PasswordReset {
  return {
    id: row.id,
    userId: row.userId,
    hashedToken: row.hashedToken,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  };
}
