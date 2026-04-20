import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {Membership} from '#core/entities/membership.js';
import {pgTable} from './common.js';
import {workspaces} from './workspaces.js';

export const memberships = pgTable(
  'memberships',
  {
    id: uuidv7PrimaryKey(),
    userId: uuid('user_id').notNull(),
    userEmail: text('user_email').notNull(),
    userName: text('user_name'),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, {onDelete: 'cascade'}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workspaces_memberships_user_workspace_unique').on(table.userId, table.workspaceId),
    index('workspaces_memberships_workspace_id_idx').on(table.workspaceId),
  ],
);

export type MembershipDb = typeof memberships.$inferSelect;
export type MembershipCreateDb = typeof memberships.$inferInsert;

export function toMembership(row: MembershipDb): Membership {
  return {
    id: row.id,
    userId: row.userId,
    userEmail: row.userEmail,
    userName: row.userName,
    workspaceId: row.workspaceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
