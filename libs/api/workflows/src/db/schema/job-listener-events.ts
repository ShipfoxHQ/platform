import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, jsonb, pgEnum, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {JobListenerEvent} from '#core/entities/job-listener-event.js';
import type {WorkflowRunTriggerReference} from '#core/entities/workflow-run.js';
import {pgTable} from './common.js';
import {jobExecutions} from './job-executions.js';
import {jobs} from './jobs.js';

export const jobListenerEventDispositionEnum = pgEnum('workflows_job_listener_event_disposition', [
  'fire',
  'resolve',
]);

export const jobListenerEvents = pgTable(
  'job_listener_events',
  {
    id: uuidv7PrimaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, {onDelete: 'cascade'}),
    disposition: jobListenerEventDispositionEnum('disposition').notNull(),
    eventRef: text('event_ref').notNull(),
    deliveryId: text('delivery_id').notNull(),
    source: text('source').notNull(),
    event: text('event').notNull(),
    triggerReference: jsonb('trigger_reference').$type<WorkflowRunTriggerReference>(),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', {withTimezone: true}).notNull(),
    consumedByExecutionId: uuid('consumed_by_execution_id').references(() => jobExecutions.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workflows_job_listener_events_job_event_ref_unique').on(
      table.jobId,
      table.eventRef,
    ),
    index('workflows_job_listener_events_job_received_idx').on(table.jobId, table.receivedAt),
  ],
);

export type JobListenerEventDb = typeof jobListenerEvents.$inferSelect;
export type JobListenerEventCreateDb = typeof jobListenerEvents.$inferInsert;

export function toJobListenerEvent(row: JobListenerEventDb): JobListenerEvent {
  return {
    id: row.id,
    jobId: row.jobId,
    disposition: row.disposition,
    eventRef: row.eventRef,
    deliveryId: row.deliveryId,
    source: row.source,
    event: row.event,
    triggerReference: row.triggerReference ?? null,
    payload: row.payload,
    receivedAt: row.receivedAt,
    consumedByExecutionId: row.consumedByExecutionId,
    createdAt: row.createdAt,
  };
}
