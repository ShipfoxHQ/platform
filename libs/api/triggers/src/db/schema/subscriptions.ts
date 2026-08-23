import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, jsonb, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {TriggerSubscription} from '#core/entities/subscription.js';
import {pgTable} from './common.js';

export const triggerSubscriptions = pgTable(
  'subscriptions',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    workflowDefinitionId: uuid('workflow_definition_id').notNull(),
    name: text('name').notNull(),
    source: text('source').notNull(),
    // NULL is a source subscription: matches every event the source delivers.
    event: text('event'),
    config: jsonb('config').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('triggers_subscriptions_definition_name_unique').on(
      table.workflowDefinitionId,
      table.name,
    ),
    index('triggers_subscriptions_match_idx').on(table.workspaceId, table.source, table.event),
    index('triggers_subscriptions_definition_idx').on(table.workflowDefinitionId),
  ],
);

export type TriggerSubscriptionDb = typeof triggerSubscriptions.$inferSelect;
export type TriggerSubscriptionInsertDb = typeof triggerSubscriptions.$inferInsert;

export function toTriggerSubscription(row: TriggerSubscriptionDb): TriggerSubscription {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    workflowDefinitionId: row.workflowDefinitionId,
    name: row.name,
    source: row.source,
    event: row.event,
    config: row.config as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
