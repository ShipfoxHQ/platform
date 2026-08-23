import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, integer, jsonb, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import {
  type TriggerReceivedEvent,
  type TriggerReceivedEventSummary,
  triggerEventOrigins,
  triggerEventOutcomes,
} from '#core/entities/received-event.js';
import {pgTable} from './common.js';

export const triggersReceivedEvents = pgTable(
  'received_events',
  {
    id: uuidv7PrimaryKey(),
    // Globally-unique idempotency key (the outbox event id), not the provider
    // delivery id: delivery ids are only unique per provider and would collide
    // across workspaces under the global event_ref unique index below.
    eventRef: text('event_ref').notNull(),
    origin: text('origin', {enum: triggerEventOrigins}).notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    provider: text('provider'),
    source: text('source').notNull(),
    event: text('event').notNull(),
    // Source event this entry replays (dev runs only); no foreign key: the
    // source row may be pruned while its replay link must stay.
    replayOfEventId: uuid('replay_of_event_id'),
    deliveryId: text('delivery_id'),
    connectionId: uuid('connection_id'),
    connectionName: text('connection_name'),
    outcome: text('outcome', {enum: triggerEventOutcomes}).notNull().default('received'),
    matchedCount: integer('matched_count').notNull().default(0),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    receivedAt: timestamp('received_at', {withTimezone: true}).notNull(),
    processedAt: timestamp('processed_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('triggers_received_events_event_ref_unique').on(table.eventRef),
    index('triggers_received_events_workspace_received_idx').on(
      table.workspaceId,
      table.receivedAt.desc(),
    ),
    index('triggers_received_events_prune_idx').on(table.createdAt),
    // Back the workspace-scoped facet group-by (distinct source / event values).
    index('triggers_received_events_workspace_source_idx').on(table.workspaceId, table.source),
    index('triggers_received_events_workspace_event_idx').on(table.workspaceId, table.event),
    // Back the replay link direction: which events replayed a given source event.
    index('triggers_received_events_replay_of_event_id_idx')
      .on(table.replayOfEventId)
      .where(sql`${table.replayOfEventId} IS NOT NULL`),
  ],
);

export type TriggerReceivedEventDb = typeof triggersReceivedEvents.$inferSelect;
export type TriggerReceivedEventInsertDb = typeof triggersReceivedEvents.$inferInsert;

export function toTriggerReceivedEvent(row: TriggerReceivedEventDb): TriggerReceivedEvent {
  return {
    id: row.id,
    eventRef: row.eventRef,
    origin: row.origin,
    workspaceId: row.workspaceId,
    provider: row.provider,
    source: row.source,
    event: row.event,
    replayOfEventId: row.replayOfEventId,
    deliveryId: row.deliveryId,
    connectionId: row.connectionId,
    connectionName: row.connectionName,
    outcome: row.outcome,
    matchedCount: row.matchedCount,
    payload: row.payload,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
    createdAt: row.createdAt,
  };
}

export const triggerReceivedEventSummaryColumns = {
  id: triggersReceivedEvents.id,
  eventRef: triggersReceivedEvents.eventRef,
  origin: triggersReceivedEvents.origin,
  workspaceId: triggersReceivedEvents.workspaceId,
  provider: triggersReceivedEvents.provider,
  source: triggersReceivedEvents.source,
  event: triggersReceivedEvents.event,
  replayOfEventId: triggersReceivedEvents.replayOfEventId,
  deliveryId: triggersReceivedEvents.deliveryId,
  connectionId: triggersReceivedEvents.connectionId,
  connectionName: triggersReceivedEvents.connectionName,
  outcome: triggersReceivedEvents.outcome,
  matchedCount: triggersReceivedEvents.matchedCount,
  receivedAt: triggersReceivedEvents.receivedAt,
  processedAt: triggersReceivedEvents.processedAt,
  createdAt: triggersReceivedEvents.createdAt,
} as const satisfies Record<keyof TriggerReceivedEventSummary, unknown>;

export function toTriggerReceivedEventSummary(
  row: Omit<TriggerReceivedEventDb, 'payload'>,
): TriggerReceivedEventSummary {
  return {...row};
}
