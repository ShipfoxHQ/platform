import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {index, jsonb, text, timestamp} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const workflowsOutbox = pgTable(
  'outbox',
  {
    id: uuidv7PrimaryKey(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', {withTimezone: true}),
  },
  (table) => [
    index('workflows_outbox_pending_idx').on(table.createdAt).where(sql`"dispatched_at" IS NULL`),
  ],
);
