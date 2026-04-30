import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {
  IntegrationConnection,
  IntegrationConnectionLifecycleStatus,
} from '#core/entities/connection.js';
import type {IntegrationProviderKind} from '#core/entities/provider.js';
import {pgTable} from './common.js';

export const integrationConnections = pgTable(
  'connections',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    provider: text('provider').notNull(),
    externalAccountId: text('external_account_id').notNull(),
    displayName: text('display_name').notNull(),
    lifecycleStatus: text('lifecycle_status').notNull().default('active'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('integrations_connections_workspace_external_unique').on(
      table.workspaceId,
      table.provider,
      table.externalAccountId,
    ),
    index('integrations_connections_workspace_id_idx').on(table.workspaceId),
  ],
);

export type IntegrationConnectionDb = typeof integrationConnections.$inferSelect;
export type IntegrationConnectionCreateDb = typeof integrationConnections.$inferInsert;

export function toIntegrationConnection(row: IntegrationConnectionDb): IntegrationConnection {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider as IntegrationProviderKind,
    externalAccountId: row.externalAccountId,
    displayName: row.displayName,
    lifecycleStatus: row.lifecycleStatus as IntegrationConnectionLifecycleStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
