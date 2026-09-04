import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {boolean, check, index, pgEnum, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';
import {runnerSessions} from './runner-sessions.js';

export const runnerJobStopReasonEnum = pgEnum('runners_job_stop_reason', [
  'run_cancelled',
  'timed_out',
]);

export const runningJobExecutions = pgTable(
  'running_jobs',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    workflowRunId: uuid('workflow_run_id').notNull(),
    workflowRunAttemptId: uuid('workflow_run_attempt_id').notNull(),
    jobId: uuid('job_id').notNull(),
    jobExecutionId: uuid('job_execution_id').notNull().unique(),
    projectId: uuid('project_id').notNull(),
    runnerSessionId: uuid('runner_session_id')
      .notNull()
      .references(() => runnerSessions.id),
    renewableInference: boolean('renewable_inference'),
    provisionerId: uuid('provisioner_id'),
    providerRunnerId: text('provider_runner_id'),
    requiredLabels: text('required_labels').array().notNull(),
    runnerLabels: text('runner_labels').array().notNull(),
    startedAt: timestamp('started_at', {withTimezone: true}).notNull().defaultNow(),
    firstHeartbeatAt: timestamp('first_heartbeat_at', {withTimezone: true}),
    lastHeartbeatAt: timestamp('last_heartbeat_at', {withTimezone: true}).notNull().defaultNow(),
    cancellationRequestedAt: timestamp('cancellation_requested_at', {withTimezone: true}),
    cancellationReason: runnerJobStopReasonEnum('cancellation_reason'),
  },
  (table) => [
    index('runners_running_jobs_no_first_heartbeat_started_idx')
      .on(table.startedAt)
      .where(sql`"first_heartbeat_at" IS NULL`),
    index('runners_running_jobs_last_heartbeat_at_idx').on(table.lastHeartbeatAt),
    index('runners_running_jobs_provider_runner_started_idx')
      .on(table.workspaceId, table.provisionerId, table.providerRunnerId, table.startedAt.desc())
      .where(sql`"provisioner_id" IS NOT NULL`),
    index('runners_running_jobs_cancellation_requested_idx')
      .on(table.workspaceId, table.provisionerId, table.providerRunnerId)
      .where(sql`"cancellation_requested_at" IS NOT NULL`),
    index('runners_running_jobs_job_id_idx').on(table.jobId),
    index('runners_running_jobs_runner_session_id_idx').on(table.runnerSessionId),
    check(
      'runners_running_jobs_link_ck',
      sql`(${table.provisionerId} IS NULL) = (${table.providerRunnerId} IS NULL)`,
    ),
  ],
);

export type RunningJobExecutionDb = typeof runningJobExecutions.$inferSelect;
export type RunningJobExecutionInsertDb = typeof runningJobExecutions.$inferInsert;
