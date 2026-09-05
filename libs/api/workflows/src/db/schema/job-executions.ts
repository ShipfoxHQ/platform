import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
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
import {toJobStatusReason} from '#core/entities/job.js';
import {
  type JobExecution,
  normalizeWorkflowExecutionEvent,
  type WorkflowExecutionEvent,
} from '#core/entities/job-execution.js';
import type {PersistedEvaluationTraceEntry} from '#core/entities/step.js';
import {pgTable} from './common.js';
import {jobStatusReasonEnum, jobs} from './jobs.js';

export const jobExecutionStatusEnum = pgEnum('workflows_job_execution_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const jobExecutions = pgTable(
  'job_executions',
  {
    id: uuidv7PrimaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, {onDelete: 'cascade'}),
    sequence: integer('sequence').notNull(),
    // A null value means no dynamic override was resolved. The core entity
    // exposes the parent job's static name/key as the effective name.
    name: text('name'),
    runner: jsonb('runner').$type<string[]>(),
    // Runner identity from the claimed event (first-write-wins, beside startedAt).
    // Plain columns, not a foreign key or a local enum: the values are opaque ids
    // and enum-shaped strings owned and validated by the runners module's own
    // event contract, not by this table.
    runnerLabels: jsonb('runner_labels').$type<string[]>(),
    templateKey: text('template_key'),
    provisionerId: uuid('provisioner_id'),
    provisionerScope: text('provisioner_scope'),
    providerKind: text('provider_kind'),
    launchKind: text('launch_kind'),
    status: jobExecutionStatusEnum('status').notNull().default('pending'),
    statusReason: jobStatusReasonEnum('status_reason'),
    statusReasonMessage: text('status_reason_message'),
    // Retained for mixed-deployment reads. New listener executions keep their
    // canonical events in workflows_job_listener_events instead.
    triggerEvents: jsonb('trigger_events').$type<WorkflowExecutionEvent[] | null>(),
    outputs: jsonb('outputs').$type<Record<string, unknown> | null>(),
    evaluationTrace: jsonb('evaluation_trace').$type<readonly PersistedEvaluationTraceEntry[]>(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
    queuedAt: timestamp('queued_at', {withTimezone: true}),
    startedAt: timestamp('started_at', {withTimezone: true}),
    finishedAt: timestamp('finished_at', {withTimezone: true}),
    timedOutAt: timestamp('timed_out_at', {withTimezone: true}),
  },
  (table) => [
    index('workflows_job_executions_job_id_idx').on(table.jobId),
    // Partial index backing the running-executions depth gauge, which counts on
    // every Prometheus scrape. Indexes only active rows so the count stays cheap
    // as the historical table grows.
    index('workflows_job_executions_running_idx')
      .on(table.status)
      .where(sql`${table.status} = 'running'`),
    uniqueIndex('workflows_job_executions_job_sequence_uq').on(table.jobId, table.sequence),
  ],
);

export type JobExecutionDb = typeof jobExecutions.$inferSelect;
export type JobExecutionDbWithoutTriggerEvents = Omit<JobExecutionDb, 'triggerEvents'>;
export type JobExecutionCreateDb = typeof jobExecutions.$inferInsert;

export const jobExecutionWithoutTriggerEventsSelection = {
  id: jobExecutions.id,
  jobId: jobExecutions.jobId,
  sequence: jobExecutions.sequence,
  name: jobExecutions.name,
  runner: jobExecutions.runner,
  runnerLabels: jobExecutions.runnerLabels,
  templateKey: jobExecutions.templateKey,
  provisionerId: jobExecutions.provisionerId,
  provisionerScope: jobExecutions.provisionerScope,
  providerKind: jobExecutions.providerKind,
  launchKind: jobExecutions.launchKind,
  status: jobExecutions.status,
  statusReason: jobExecutions.statusReason,
  statusReasonMessage: jobExecutions.statusReasonMessage,
  outputs: jobExecutions.outputs,
  evaluationTrace: jobExecutions.evaluationTrace,
  version: jobExecutions.version,
  createdAt: jobExecutions.createdAt,
  updatedAt: jobExecutions.updatedAt,
  queuedAt: jobExecutions.queuedAt,
  startedAt: jobExecutions.startedAt,
  finishedAt: jobExecutions.finishedAt,
  timedOutAt: jobExecutions.timedOutAt,
} satisfies Record<keyof JobExecutionDbWithoutTriggerEvents, unknown>;

export function toJobExecution(
  row: JobExecutionDb | JobExecutionDbWithoutTriggerEvents,
  fallbackName: string,
): JobExecution {
  return {
    id: row.id,
    jobId: row.jobId,
    sequence: row.sequence,
    nameOverride: row.name,
    name: row.name ?? fallbackName,
    runner: row.runner as string[] | null,
    status: row.status,
    statusReason: toJobStatusReason(row.statusReason),
    statusReasonMessage: row.statusReasonMessage,
    // Keep legacy/corrupt JSONB rows readable. The diagnostic context route
    // reports an invalid trigger-events shape as an empty collection rather
    // than allowing a mapper `.map` failure to abort the read.
    triggerEvents:
      'triggerEvents' in row && Array.isArray(row.triggerEvents)
        ? row.triggerEvents.map(normalizeWorkflowExecutionEvent)
        : [],
    outputs: row.outputs,
    evaluationTrace: row.evaluationTrace ?? null,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    timedOutAt: row.timedOutAt,
  };
}
