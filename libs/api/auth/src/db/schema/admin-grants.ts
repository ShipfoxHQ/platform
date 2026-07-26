import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, pgEnum, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {AdminGrant} from '#core/entities/admin-grant.js';
import {pgTable} from './common.js';
import {users} from './users.js';

export const adminRoleEnum = pgEnum('auth_admin_role', [
  'admin-observer',
  'admin-operator',
  'admin-owner',
]);

export const adminGrants = pgTable(
  'admin_grants',
  {
    id: uuidv7PrimaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, {onDelete: 'cascade'}),
    role: adminRoleEnum('role').notNull(),
    revokedAt: timestamp('revoked_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    index('auth_admin_grants_user_id_idx').on(table.userId),
    index('auth_admin_grants_active_owners_idx')
      .on(table.userId)
      .where(sql`${table.role} = 'admin-owner' AND ${table.revokedAt} IS NULL`),
    uniqueIndex('auth_admin_grants_active_user_role_unique')
      .on(table.userId, table.role)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

export type AdminGrantDb = typeof adminGrants.$inferSelect;
export type AdminGrantCreateDb = typeof adminGrants.$inferInsert;

export function toAdminGrant(row: AdminGrantDb): AdminGrant {
  return {
    id: row.id,
    userId: row.userId,
    role: row.role,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
