import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {IntegrationConnectionRepositoryGrant} from '#core/entities/repository-grant.js';
import {pgTable} from './common.js';
import {integrationConnections} from './connections.js';

export const integrationConnectionRepositoryGrants = pgTable(
  'connection_repository_grants',
  {
    id: uuidv7PrimaryKey(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id, {onDelete: 'cascade'}),
    workspaceId: uuid('workspace_id').notNull(),
    externalRepositoryId: text('external_repository_id').notNull(),
    repositoryOwner: text('repository_owner').notNull(),
    repositoryName: text('repository_name').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('integrations_connection_repository_grants_connection_external_unique').on(
      table.connectionId,
      table.externalRepositoryId,
    ),
    index('integrations_connection_repository_grants_connection_owner_name_idx').on(
      table.connectionId,
      sql`lower(${table.repositoryOwner})`,
      sql`lower(${table.repositoryName})`,
    ),
  ],
);

export type IntegrationConnectionRepositoryGrantDb =
  typeof integrationConnectionRepositoryGrants.$inferSelect;
export type IntegrationConnectionRepositoryGrantCreateDb =
  typeof integrationConnectionRepositoryGrants.$inferInsert;

export function toIntegrationConnectionRepositoryGrant(
  row: IntegrationConnectionRepositoryGrantDb,
): IntegrationConnectionRepositoryGrant {
  return {
    id: row.id,
    connectionId: row.connectionId,
    workspaceId: row.workspaceId,
    externalRepositoryId: row.externalRepositoryId,
    repositoryOwner: row.repositoryOwner,
    repositoryName: row.repositoryName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
