import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, integer, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {IntegrationConnectionLifecycleStatus} from '#core/entities/connection.js';
import {pgTable} from './common.js';

export const integrationSecretCleanups = pgTable(
  'secret_cleanups',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    provider: text('provider').notNull(),
    connectionId: uuid('connection_id').notNull(),
    externalAccountId: text('external_account_id').notNull(),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    lifecycleStatus: text('lifecycle_status')
      .$type<IntegrationConnectionLifecycleStatus>()
      .notNull(),
    connectionCreatedAt: timestamp('connection_created_at', {withTimezone: true}).notNull(),
    connectionUpdatedAt: timestamp('connection_updated_at', {withTimezone: true}).notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', {withTimezone: true}).notNull().defaultNow(),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('integrations_secret_cleanups_provider_connection_unique').on(
      table.provider,
      table.connectionId,
    ),
    index('integrations_secret_cleanups_pending_idx').on(
      table.nextAttemptAt,
      table.createdAt,
      table.id,
    ),
  ],
);

export type IntegrationSecretCleanupDb = typeof integrationSecretCleanups.$inferSelect;
