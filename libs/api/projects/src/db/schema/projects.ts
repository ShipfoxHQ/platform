import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {Project} from '#core/entities/project.js';
import {pgTable} from './common.js';
import {repositories} from './repositories.js';

export const projects = pgTable(
  'projects',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('projects_workspace_repository_unique').on(table.workspaceId, table.repositoryId),
    index('projects_workspace_created_id_idx').on(table.workspaceId, table.createdAt, table.id),
  ],
);

export type ProjectDb = typeof projects.$inferSelect;
export type ProjectCreateDb = typeof projects.$inferInsert;

export function toProject(row: ProjectDb): Project {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    repositoryId: row.repositoryId,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
