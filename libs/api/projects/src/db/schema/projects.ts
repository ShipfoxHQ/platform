import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {Project} from '#core/entities/project.js';
import {pgTable} from './common.js';

export const projects = pgTable(
  'projects',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    sourceConnectionId: uuid('source_connection_id').notNull(),
    sourceExternalRepositoryId: text('source_external_repository_id').notNull(),
    sourceRepositoryOwner: text('source_repository_owner'),
    sourceRepositoryName: text('source_repository_name'),
    sourceDefaultBranch: text('source_default_branch'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('projects_source_unique').on(
      table.sourceConnectionId,
      table.sourceExternalRepositoryId,
    ),
    uniqueIndex('projects_workspace_slug_unique').on(table.workspaceId, table.slug),
    index('projects_workspace_created_id_idx').on(table.workspaceId, table.createdAt, table.id),
    index('projects_source_repository_lookup_idx').on(
      table.workspaceId,
      table.sourceConnectionId,
      sql`lower(${table.sourceRepositoryOwner})`,
      sql`lower(${table.sourceRepositoryName})`,
    ),
  ],
);

export type ProjectDb = typeof projects.$inferSelect;
export type ProjectCreateDb = typeof projects.$inferInsert;

export function toProject(row: ProjectDb): Project {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    sourceConnectionId: row.sourceConnectionId,
    sourceExternalRepositoryId: row.sourceExternalRepositoryId,
    sourceRepositoryOwner: row.sourceRepositoryOwner,
    sourceRepositoryName: row.sourceRepositoryName,
    sourceDefaultBranch: row.sourceDefaultBranch,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
