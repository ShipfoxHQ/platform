import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {Invitation} from '#core/entities/invitation.js';
import {pgTable} from './common.js';
import {workspaces} from './workspaces.js';

export const invitations = pgTable(
  'invitations',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, {onDelete: 'cascade'}),
    email: text('email').notNull(),
    hashedToken: text('hashed_token').notNull(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    acceptedAt: timestamp('accepted_at', {withTimezone: true}),
    acceptedByUserId: uuid('accepted_by_user_id'),
    invitedByUserId: uuid('invited_by_user_id').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workspaces_invitations_hashed_token_unique').on(table.hashedToken),
    index('workspaces_invitations_workspace_email_idx').on(table.workspaceId, table.email),
  ],
);

export type InvitationDb = typeof invitations.$inferSelect;
export type InvitationCreateDb = typeof invitations.$inferInsert;

export function toInvitation(row: InvitationDb): Invitation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    hashedToken: row.hashedToken,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    acceptedByUserId: row.acceptedByUserId,
    invitedByUserId: row.invitedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
