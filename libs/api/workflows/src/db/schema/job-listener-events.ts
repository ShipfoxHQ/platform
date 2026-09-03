import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  JobListenerEvent,
  JobListenerEventOutcome,
  JobListenerEventOutcomeReason,
} from '#core/entities/job-listener-event.js';
import type {WorkflowRunTriggerReference} from '#core/entities/workflow-run.js';
import {pgTable} from './common.js';
import {jobExecutions} from './job-executions.js';
import {jobs} from './jobs.js';

export const jobListenerEventDispositionEnum = pgEnum('workflows_job_listener_event_disposition', [
  'fire',
  'resolve',
]);

export const jobListenerEventOutcomeEnum = pgEnum('workflows_job_listener_event_outcome', [
  'pending',
  'consumed',
  'honored',
  'rejected',
  'abandoned',
]);

export const jobListenerEventOutcomeReasonEnum = pgEnum(
  'workflows_job_listener_event_outcome_reason',
  ['payload_too_large', 'until', 'timeout', 'max_executions', 'cancelled'],
);

export const jobListenerEvents = pgTable(
  'job_listener_events',
  {
    id: uuidv7PrimaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, {onDelete: 'cascade'}),
    disposition: jobListenerEventDispositionEnum('disposition').notNull(),
    outcome: jobListenerEventOutcomeEnum('outcome').notNull().default('pending'),
    outcomeReason: jobListenerEventOutcomeReasonEnum('outcome_reason'),
    eventRef: text('event_ref').notNull(),
    deliveryId: text('delivery_id').notNull(),
    source: text('source').notNull(),
    event: text('event').notNull(),
    triggerReference: jsonb('trigger_reference').$type<WorkflowRunTriggerReference>(),
    payload: jsonb('payload'),
    storedPayloadBytes: integer('stored_payload_bytes').notNull(),
    normalizedEventBytes: integer('normalized_event_bytes').notNull(),
    receivedAt: timestamp('received_at', {withTimezone: true}).notNull(),
    consumedByExecutionId: uuid('consumed_by_execution_id').references(() => jobExecutions.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workflows_job_listener_events_job_event_ref_unique').on(
      table.jobId,
      table.eventRef,
    ),
    index('workflows_job_listener_events_job_received_idx').on(table.jobId, table.receivedAt),
    index('workflows_job_listener_events_pending_order_idx')
      .on(table.jobId, table.receivedAt, table.id)
      .where(sql`${table.consumedByExecutionId} IS NULL AND ${table.outcome} = 'pending'`),
    index('workflows_job_listener_events_consumed_order_idx')
      .on(table.consumedByExecutionId, table.receivedAt, table.id)
      .where(sql`${table.consumedByExecutionId} IS NOT NULL`),
    check(
      'workflows_job_listener_events_byte_counts_ck',
      sql`${table.storedPayloadBytes} >= 0 AND ${table.normalizedEventBytes} >= 0`,
    ),
    check(
      'workflows_job_listener_events_outcome_consistency_ck',
      sql`(
        (${table.outcome} = 'pending'
          AND ${table.disposition} IN ('fire', 'resolve')
          AND ${table.consumedByExecutionId} IS NULL
          AND ${table.payload} IS NOT NULL
          AND ${table.outcomeReason} IS NULL)
        OR (${table.outcome} = 'consumed'
          AND ${table.disposition} = 'fire'
          AND ${table.consumedByExecutionId} IS NOT NULL
          AND ${table.payload} IS NOT NULL
          AND ${table.outcomeReason} IS NULL)
        OR (${table.outcome} = 'honored'
          AND ${table.disposition} = 'resolve'
          AND ${table.consumedByExecutionId} IS NULL
          AND ${table.payload} IS NOT NULL
          AND ${table.outcomeReason} IS NULL)
        OR (${table.outcome} = 'rejected'
          AND ${table.disposition} = 'fire'
          AND ${table.consumedByExecutionId} IS NULL
          AND ${table.payload} IS NULL
          AND ${table.outcomeReason} = 'payload_too_large')
        OR (${table.outcome} = 'abandoned'
          AND ${table.disposition} IN ('fire', 'resolve')
          AND ${table.consumedByExecutionId} IS NULL
          AND ${table.payload} IS NOT NULL
          AND ${table.outcomeReason} IN ('until', 'timeout', 'max_executions', 'cancelled'))
      )`,
    ),
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
    outcome: row.outcome as JobListenerEventOutcome,
    outcomeReason: row.outcomeReason as JobListenerEventOutcomeReason | null,
    payload: row.payload,
    storedPayloadBytes: row.storedPayloadBytes,
    normalizedEventBytes: row.normalizedEventBytes,
    receivedAt: row.receivedAt,
    consumedByExecutionId: row.consumedByExecutionId,
    createdAt: row.createdAt,
  };
}
