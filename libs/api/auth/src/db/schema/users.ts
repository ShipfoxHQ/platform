import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {pgEnum, text, timestamp, uniqueIndex} from 'drizzle-orm/pg-core';
import type {User, UserStatus} from '#core/entities/user.js';
import {pgTable} from './common.js';

export const userStatusEnum = pgEnum('auth_user_status', ['active', 'suspended', 'deleted']);

export const users = pgTable(
  'users',
  {
    id: uuidv7PrimaryKey(),
    email: text('email').notNull(),
    hashedPassword: text('hashed_password').notNull(),
    name: text('name'),
    emailVerifiedAt: timestamp('email_verified_at', {withTimezone: true}),
    status: userStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('auth_users_email_unique').on(table.email)],
);

export type UserDb = typeof users.$inferSelect;
export type UserCreateDb = typeof users.$inferInsert;

export function toUser(row: UserDb): User {
  return {
    id: row.id,
    email: row.email,
    hashedPassword: row.hashedPassword,
    name: row.name,
    emailVerifiedAt: row.emailVerifiedAt,
    status: row.status as UserStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
