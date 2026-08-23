import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, jsonb, pgEnum, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {
  DefinitionSyncDiagnostic,
  DefinitionSyncErrorCode,
  DefinitionSyncState,
  DefinitionSyncStatus,
} from '#core/entities/sync-state.js';
import {pgTable} from './common.js';

export const definitionSyncStatusEnum = pgEnum('definitions_sync_status', [
  'pending',
  'syncing',
  'succeeded',
  'failed',
]);

export const definitionSyncErrorCodeEnum = pgEnum('definitions_sync_error_code', [
  'no-workflow-files',
  'invalid-definition',
  'provider-repository-not-found',
  'provider-file-not-found',
  'provider-access-denied',
  'provider-rate-limited',
  'provider-timeout',
  'provider-unavailable',
  'provider-malformed-response',
  'content-too-large',
  'too-many-files',
  'connection-unavailable',
  'unknown',
]);

export const definitionSyncStates = pgTable(
  'sync_states',
  {
    id: uuidv7PrimaryKey(),
    projectId: uuid('project_id').notNull(),
    sourceConnectionId: uuid('source_connection_id').notNull(),
    sourceExternalRepositoryId: text('source_external_repository_id').notNull(),
    ref: text('ref').notNull(),
    status: definitionSyncStatusEnum('status').notNull().default('pending'),
    lastErrorCode: definitionSyncErrorCodeEnum('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    warnings: jsonb('warnings').notNull().default([]).$type<DefinitionSyncDiagnostic[]>(),
    startedAt: timestamp('started_at', {withTimezone: true}),
    finishedAt: timestamp('finished_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('definitions_sync_states_source_unique').on(
      table.projectId,
      table.sourceConnectionId,
      table.sourceExternalRepositoryId,
      table.ref,
    ),
    index('definitions_sync_states_failed_idx').on(table.updatedAt).where(sql`"status" = 'failed'`),
  ],
);

export type DefinitionSyncStateDb = typeof definitionSyncStates.$inferSelect;
export type DefinitionSyncStateCreateDb = typeof definitionSyncStates.$inferInsert;

export function toDefinitionSyncState(row: DefinitionSyncStateDb): DefinitionSyncState {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceConnectionId: row.sourceConnectionId,
    sourceExternalRepositoryId: row.sourceExternalRepositoryId,
    ref: row.ref,
    status: row.status as DefinitionSyncStatus,
    lastErrorCode: row.lastErrorCode as DefinitionSyncErrorCode | null,
    lastErrorMessage: row.lastErrorMessage,
    diagnostics: row.warnings ?? [],
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
