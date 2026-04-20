import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {jsonb, pgEnum, text, timestamp} from 'drizzle-orm/pg-core';
import type {Workspace, WorkspaceStatus} from '#core/entities/workspace.js';
import {pgTable} from './common.js';

export const workspaceStatusEnum = pgEnum('workspaces_workspace_status', [
  'active',
  'suspended',
  'deleted',
]);

export const workspaces = pgTable('workspaces', {
  id: uuidv7PrimaryKey(),
  name: text('name').notNull(),
  status: workspaceStatusEnum('status').notNull().default('active'),
  settings: jsonb('settings').notNull().default({}),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
});

export type WorkspaceDb = typeof workspaces.$inferSelect;
export type WorkspaceCreateDb = typeof workspaces.$inferInsert;

export function toWorkspace(row: WorkspaceDb): Workspace {
  return {
    id: row.id,
    name: row.name,
    status: row.status as WorkspaceStatus,
    settings: row.settings as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
