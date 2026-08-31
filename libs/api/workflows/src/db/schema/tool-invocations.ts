import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';
import {jobExecutions} from './job-executions.js';
import {stepAttempts} from './step-attempts.js';
import {steps} from './steps.js';

export const toolInvocationStatusEnum = pgEnum('workflows_tool_invocation_status', [
  'queued',
  'in_flight',
  'settled',
]);

export const toolInvocations = pgTable(
  'tool_invocations',
  {
    id: uuidv7PrimaryKey(),
    stepId: uuid('step_id')
      .notNull()
      .references(() => steps.id, {onDelete: 'cascade'}),
    stepAttemptId: uuid('step_attempt_id')
      .notNull()
      .references(() => stepAttempts.id, {onDelete: 'cascade'}),
    jobExecutionId: uuid('job_execution_id')
      .notNull()
      .references(() => jobExecutions.id, {onDelete: 'cascade'}),
    workspaceId: uuid('workspace_id').notNull(),
    status: toolInvocationStatusEnum('status').notNull().default('queued'),
    callIndex: integer('call_index').notNull().default(0),
    dueAt: timestamp('due_at', {withTimezone: true}).notNull(),
    claimedBy: text('claimed_by'),
    claimExpiresAt: timestamp('claim_expires_at', {withTimezone: true}),
    lastErrorCode: text('last_error_code'),
  },
  (table) => [
    unique('workflows_tool_invocations_step_attempt_id_uq').on(table.stepAttemptId),
    index('workflows_tool_invocations_job_execution_id_idx').on(table.jobExecutionId),
    index('workflows_tool_invocations_due_at_unsettled_idx')
      .on(table.dueAt)
      .where(sql`${table.status} <> 'settled'`),
    foreignKey({
      name: 'workflows_tool_invocations_step_id_job_execution_id_workflows_steps_fk',
      columns: [table.stepId, table.jobExecutionId],
      foreignColumns: [steps.id, steps.jobExecutionId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'workflows_tool_invocations_step_attempt_id_step_id_job_execution_id_workflows_step_attempts_fk',
      columns: [table.stepAttemptId, table.stepId, table.jobExecutionId],
      foreignColumns: [stepAttempts.id, stepAttempts.stepId, stepAttempts.jobExecutionId],
    }).onDelete('cascade'),
    check('workflows_tool_invocations_call_index_nonnegative_ck', sql`${table.callIndex} >= 0`),
  ],
);

export type ToolInvocationDb = typeof toolInvocations.$inferSelect;
export type ToolInvocationCreateDb = typeof toolInvocations.$inferInsert;
