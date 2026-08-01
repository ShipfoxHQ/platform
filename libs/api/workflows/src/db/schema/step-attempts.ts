import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  PersistedEvaluationTraceEntry,
  StepAttempt,
  StepAttemptLogOutcome,
  StepAttemptStatus,
} from '#core/entities/step.js';
import {pgTable} from './common.js';
import {stepStatusEnum, steps} from './steps.js';

// Append-only execution history. One row per dispatched attempt of a step,
// inserted `running` at dispatch and finalized terminal at report. `steps` holds
// the fast current projection; this table is the audit trail. The unique
// (step_id, attempt) constraint is the idempotency anchor.
export const stepAttempts = pgTable(
  'step_attempts',
  {
    id: uuidv7PrimaryKey(),
    stepId: uuid('step_id')
      .notNull()
      .references(() => steps.id, {onDelete: 'cascade'}),
    jobExecutionId: uuid('job_execution_id').notNull(),
    attempt: integer('attempt').notNull(),
    executionOrder: integer('execution_order').notNull(),
    // Reuses the step status enum, but a row is created only once dispatched, so
    // it is never 'pending'.
    status: stepStatusEnum('status').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>(),
    evaluationTrace: jsonb('evaluation_trace').$type<readonly PersistedEvaluationTraceEntry[]>(),
    output: jsonb('output').$type<Record<string, unknown>>(),
    response: text('response'),
    error: jsonb('error').$type<Record<string, unknown>>(),
    exitCode: integer('exit_code'),
    logOutcome: text('log_outcome').$type<StepAttemptLogOutcome>(),
    gateResult: jsonb('gate_result').$type<Record<string, unknown>>(),
    restartFeedback: text('restart_feedback'),
    startedAt: timestamp('started_at', {withTimezone: true}).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', {withTimezone: true}),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    unique('workflows_step_attempts_step_id_attempt_uq').on(table.stepId, table.attempt),
    unique('workflows_step_attempts_job_execution_id_execution_order_uq').on(
      table.jobExecutionId,
      table.executionOrder,
    ),
    foreignKey({
      name: 'workflows_step_attempts_step_id_job_execution_id_workflows_steps_fk',
      columns: [table.stepId, table.jobExecutionId],
      foreignColumns: [steps.id, steps.jobExecutionId],
    }).onDelete('cascade'),
    check('workflows_step_attempts_attempt_positive_ck', sql`${table.attempt} > 0`),
    check('workflows_step_attempts_execution_order_positive_ck', sql`${table.executionOrder} > 0`),
    check(
      'workflows_step_attempts_status_dispatched_ck',
      sql`${table.status} NOT IN ('pending', 'skipped')`,
    ),
    check(
      'workflows_step_attempts_log_outcome_ck',
      sql`${table.logOutcome} IS NULL OR ${table.logOutcome} IN ('drained', 'abandoned')`,
    ),
  ],
);

export type StepAttemptDb = typeof stepAttempts.$inferSelect;
export type StepAttemptCreateDb = typeof stepAttempts.$inferInsert;

export function toStepAttempt(row: StepAttemptDb): StepAttempt {
  return {
    id: row.id,
    stepId: row.stepId,
    attempt: row.attempt,
    executionOrder: row.executionOrder,
    status: row.status as StepAttemptStatus,
    config: (row.config as Record<string, unknown>) ?? null,
    evaluationTrace: row.evaluationTrace ?? null,
    output: (row.output as Record<string, unknown>) ?? null,
    response: row.response ?? null,
    error: (row.error as Record<string, unknown>) ?? null,
    exitCode: row.exitCode ?? null,
    logOutcome: row.logOutcome ?? null,
    gateResult: (row.gateResult as Record<string, unknown>) ?? null,
    restartFeedback: row.restartFeedback ?? null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    createdAt: row.createdAt,
  };
}
