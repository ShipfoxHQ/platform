import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {EmailVerification} from '#core/entities/email-verification.js';
import {pgTable} from './common.js';
import {users} from './users.js';

export const emailVerifications = pgTable(
  'email_verifications',
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
    uniqueIndex('auth_email_verifications_hashed_token_unique').on(table.hashedToken),
    index('auth_email_verifications_user_id_idx').on(table.userId),
  ],
);

export type EmailVerificationDb = typeof emailVerifications.$inferSelect;
export type EmailVerificationCreateDb = typeof emailVerifications.$inferInsert;

export function toEmailVerification(row: EmailVerificationDb): EmailVerification {
  return {
    id: row.id,
    userId: row.userId,
    hashedToken: row.hashedToken,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  };
}
