import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {JobListenerSubscription} from '#core/entities/job-listener-subscription.js';
import {pgTable} from './common.js';

export const jobListenerMatcherKindEnum = pgEnum('triggers_job_listener_matcher_kind', [
  'on',
  'until',
]);

export const jobListenerSubscriptions = pgTable(
  'job_listener_subscriptions',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    workflowRunId: uuid('workflow_run_id').notNull(),
    jobId: uuid('job_id').notNull(),
    kind: jobListenerMatcherKindEnum('kind').notNull(),
    matcherOrdinal: integer('matcher_ordinal').notNull(),
    source: text('source').notNull(),
    // NULL is a source subscription: matches every event the source delivers.
    event: text('event'),
    config: jsonb('config').notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('triggers_job_listener_subscriptions_job_kind_ordinal_unique').on(
      table.jobId,
      table.kind,
      table.matcherOrdinal,
    ),
    index('triggers_job_listener_subscriptions_match_idx').on(
      table.workspaceId,
      table.source,
      table.event,
    ),
    index('triggers_job_listener_subscriptions_job_idx').on(table.jobId),
  ],
);

export type JobListenerSubscriptionDb = typeof jobListenerSubscriptions.$inferSelect;
export type JobListenerSubscriptionInsertDb = typeof jobListenerSubscriptions.$inferInsert;

export function toJobListenerSubscription(row: JobListenerSubscriptionDb): JobListenerSubscription {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workflowRunId: row.workflowRunId,
    jobId: row.jobId,
    kind: row.kind,
    matcherOrdinal: row.matcherOrdinal,
    source: row.source,
    event: row.event,
    config: row.config,
    createdAt: row.createdAt,
  };
}
