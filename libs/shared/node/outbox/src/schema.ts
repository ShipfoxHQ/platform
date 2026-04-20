import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, jsonb, type pgTableCreator, text, timestamp} from 'drizzle-orm/pg-core';

export function createOutboxTable(pgTable: ReturnType<typeof pgTableCreator>) {
  return pgTable(
    'outbox',
    {
      id: uuidv7PrimaryKey(),
      eventType: text('event_type').notNull(),
      payload: jsonb('payload').notNull(),
      createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
      dispatchedAt: timestamp('dispatched_at', {withTimezone: true}),
    },
    (table) => [
      index('outbox_pending_idx').on(table.createdAt).where(sql`"dispatched_at" IS NULL`),
    ],
  );
}

export type OutboxTable = ReturnType<typeof createOutboxTable>;
