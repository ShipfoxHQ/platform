import {boolean, doublePrecision, index, integer, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

/**
 * Usage's commutative job projection. The SQL migration partitions this table by
 * recorded_at; the nullable key is intentional because queued and claimed events
 * arrive before the terminal publication snapshot exists.
 */
export const usageJobExecutions = pgTable(
  'job_executions',
  {
    jobExecutionId: uuid('job_execution_id').notNull(),
    jobId: uuid('job_id').notNull(),
    workflowRunId: uuid('workflow_run_id').notNull(),
    workflowRunAttemptId: uuid('workflow_run_attempt_id').notNull(),
    workspaceId: uuid('workspace_id'),
    projectId: uuid('project_id'),
    definitionId: uuid('definition_id'),
    jobKey: text('job_key'),
    runNumber: integer('run_number'),
    requestedLabels: text('requested_labels').array(),
    runnerLabels: text('runner_labels').array(),
    templateKey: text('template_key'),
    provisionerId: uuid('provisioner_id'),
    provisionerScope: text('provisioner_scope'),
    providerKind: text('provider_kind'),
    launchKind: text('launch_kind'),
    runnerClass: text('runner_class'),
    runnerArch: text('runner_arch'),
    runnerCpu: text('runner_cpu'),
    managed: boolean('managed'),
    queuedAt: timestamp('queued_at', {withTimezone: true}),
    queuedAtKnown: boolean('queued_at_known').notNull().default(false),
    startedAt: timestamp('started_at', {withTimezone: true}),
    finishedAt: timestamp('finished_at', {withTimezone: true}),
    leaseExpiredAt: timestamp('lease_expired_at', {withTimezone: true}),
    status: text('status', {enum: ['succeeded', 'failed', 'cancelled']}),
    statusReason: text('status_reason'),
    cancellationReason: text('cancellation_reason'),
    durationSeconds: doublePrecision('duration_seconds'),
    state: text('state', {enum: ['queued', 'running', 'terminated']}),
    recordedAt: timestamp('recorded_at', {withTimezone: true}),
  },
  (table) => [
    index('usage_job_executions_workspace_recorded_idx').on(table.workspaceId, table.recordedAt),
    index('usage_job_executions_recorded_job_execution_idx').on(
      table.recordedAt,
      table.jobExecutionId,
    ),
    index('usage_job_executions_workflow_run_idx').on(table.workflowRunId),
    index('usage_job_executions_job_execution_idx').on(table.jobExecutionId),
  ],
);

export type UsageJobExecutionDb = typeof usageJobExecutions.$inferSelect;
export type UsageJobExecutionInsertDb = typeof usageJobExecutions.$inferInsert;
