import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, jsonb, pgEnum, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import type {Workspace, WorkspaceStatus} from '#core/entities/workspace.js';
import {pgTable} from './common.js';

export const workspaceStatusEnum = pgEnum('workspaces_workspace_status', [
  'active',
  'suspended',
  'deleted',
]);

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuidv7PrimaryKey(),
    name: text('name').notNull(),
    status: workspaceStatusEnum('status').notNull().default('active'),
    settings: jsonb('settings').notNull().default({}),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [index('workspaces_name_id_idx').on(table.name, table.id)],
);

export type WorkspaceDb = typeof workspaces.$inferSelect;
export type WorkspaceCreateDb = typeof workspaces.$inferInsert;

export function toWorkspace(row: WorkspaceDb): Workspace {
  return {
    id: row.id,
    name: row.name,
    status: row.status as WorkspaceStatus,
    settings: row.settings as Record<string, unknown>,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
