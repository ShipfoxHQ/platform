import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {jsonb, pgEnum, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {VcsConnection, VcsProviderKind} from '#core/entities/vcs-connection.js';
import {pgTable} from './common.js';

export const vcsProviderEnum = pgEnum('projects_vcs_provider', ['test', 'github', 'gitlab']);

export const vcsConnections = pgTable(
  'vcs_connections',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    provider: vcsProviderEnum('provider').notNull(),
    providerHost: text('provider_host').notNull(),
    externalConnectionId: text('external_connection_id').notNull(),
    displayName: text('display_name').notNull(),
    credentials: jsonb('credentials').notNull().default({}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('projects_vcs_connections_workspace_external_unique').on(
      table.workspaceId,
      table.provider,
      table.providerHost,
      table.externalConnectionId,
    ),
  ],
);

export type VcsConnectionDb = typeof vcsConnections.$inferSelect;
export type VcsConnectionCreateDb = typeof vcsConnections.$inferInsert;

export function toVcsConnection(row: VcsConnectionDb): VcsConnection {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider as VcsProviderKind,
    providerHost: row.providerHost,
    externalConnectionId: row.externalConnectionId,
    displayName: row.displayName,
    credentials: row.credentials as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
