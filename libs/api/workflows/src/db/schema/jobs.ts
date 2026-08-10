import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  JOB_STATUS_REASONS,
  type Job,
  type JobListeningTrigger,
  toJobStatusReason,
} from '#core/entities/job.js';
import type {PersistedEvaluationTraceEntry} from '#core/entities/step.js';
import {pgTable} from './common.js';
import {workflowRunAttempts} from './workflow-run-attempts.js';

export const jobStatusEnum = pgEnum('workflows_job_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
]);

export const jobStatusReasonEnum = pgEnum('workflows_job_status_reason', JOB_STATUS_REASONS);

export const jobModeEnum = pgEnum('workflows_job_mode', ['one_shot', 'listening']);

export const jobCheckoutContentsEnum = pgEnum('workflows_checkout_contents', ['read', 'write']);

export const jobOnResolveEnum = pgEnum('workflows_job_on_resolve', ['finish', 'cancel']);

export const listenerStatusEnum = pgEnum('workflows_listener_status', [
  'inactive',
  'listening',
  'resolved',
]);

export const resolutionReasonEnum = pgEnum('workflows_resolution_reason', [
  'until',
  'timeout',
  'max_executions',
  'cancelled',
]);

export const jobs = pgTable(
  'jobs',
  {
    id: uuidv7PrimaryKey(),
    workflowRunAttemptId: uuid('workflow_run_attempt_id')
      .notNull()
      .references(() => workflowRunAttempts.id, {onDelete: 'cascade'}),
    key: text('key').notNull(),
    mode: jobModeEnum('mode').notNull().default('one_shot'),
    name: text('name'),
    // This is the job's execution verdict, not its runtime lifecycle. Active execution state
    // lives on job_executions and must be read there when a surface needs to distinguish
    // waiting from executing.
    status: jobStatusEnum('status').notNull().default('pending'),
    statusReason: jobStatusReasonEnum('status_reason'),
    carriedOver: boolean('carried_over').notNull().default(false),
    checkoutPersistCredentials: boolean('checkout_persist_credentials').notNull(),
    checkoutPermissionsContents: jobCheckoutContentsEnum('checkout_permissions_contents').notNull(),
    success: text('success'),
    evaluationTrace: jsonb('evaluation_trace').$type<readonly PersistedEvaluationTraceEntry[]>(),
    executionTimeoutMs: integer('execution_timeout_ms'),
    listeningTimeoutMs: bigint('listening_timeout_ms', {mode: 'number'}),
    maxExecutions: integer('max_executions'),
    onResolve: jobOnResolveEnum('on_resolve'),
    batchDebounceMs: integer('batch_debounce_ms'),
    batchMaxSize: integer('batch_max_size'),
    batchMaxWaitMs: integer('batch_max_wait_ms'),
    listenerStatus: listenerStatusEnum('listener_status').notNull().default('inactive'),
    resolutionReason: resolutionReasonEnum('resolution_reason'),
    listeningOn: jsonb('listening_on').$type<JobListeningTrigger[]>(),
    listeningUntil: jsonb('listening_until').$type<JobListeningTrigger[]>(),
    outputs: jsonb('outputs').$type<Record<string, unknown> | null>(),
    dependencies: jsonb('dependencies').notNull().$type<string[]>(),
    runner: jsonb('runner').$type<string[]>(),
    position: integer('position').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    index('workflows_jobs_workflow_run_attempt_id_idx').on(table.workflowRunAttemptId),
    index('workflows_jobs_active_listeners_idx')
      .on(table.listenerStatus)
      .where(sql`${table.listenerStatus} = 'listening'`),
  ],
);

export type JobDb = typeof jobs.$inferSelect;
export type JobCreateDb = typeof jobs.$inferInsert;

export function toJob(row: JobDb): Job {
  return {
    id: row.id,
    workflowRunAttemptId: row.workflowRunAttemptId,
    key: row.key,
    name: row.name,
    mode: row.mode,
    status: row.status,
    statusReason: toJobStatusReason(row.statusReason),
    carriedOver: row.carriedOver,
    checkout: {
      permissions: {contents: row.checkoutPermissionsContents},
      persistCredentials: row.checkoutPersistCredentials,
    },
    success: row.success,
    evaluationTrace: row.evaluationTrace ?? null,
    executionTimeoutMs: row.executionTimeoutMs,
    listeningTimeoutMs: row.listeningTimeoutMs,
    maxExecutions: row.maxExecutions,
    onResolve: row.onResolve,
    batchDebounceMs: row.batchDebounceMs,
    batchMaxSize: row.batchMaxSize,
    batchMaxWaitMs: row.batchMaxWaitMs,
    listenerStatus: row.listenerStatus,
    resolutionReason: row.resolutionReason,
    listeningOn: row.listeningOn,
    listeningUntil: row.listeningUntil,
    outputs: row.outputs,
    dependencies: row.dependencies as string[],
    runner: row.runner as string[] | null,
    position: row.position,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
