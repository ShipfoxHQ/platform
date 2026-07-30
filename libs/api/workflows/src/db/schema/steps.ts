import type {WorkflowExpression} from '@shipfox/expression';
import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  type PersistedEvaluationTraceEntry,
  STEP_STATUS_REASONS,
  type Step,
  type StepConfigDispatchPlan,
  type StepType,
  toStepStatusReason,
} from '#core/entities/step.js';
import {pgTable} from './common.js';
import {jobExecutions} from './job-executions.js';

export const stepStatusEnum = pgEnum('workflows_step_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
]);

export const stepStatusReasonEnum = pgEnum('workflows_step_status_reason', STEP_STATUS_REASONS);

export const steps = pgTable(
  'steps',
  {
    id: uuidv7PrimaryKey(),
    jobExecutionId: uuid('job_execution_id').notNull(),
    key: text('key'),
    name: text('name').notNull(),
    sourceLocation: jsonb('source_location').$type<Step['sourceLocation']>(),
    status: stepStatusEnum('status').notNull().default('pending'),
    statusReason: stepStatusReasonEnum('status_reason'),
    evaluationTrace: jsonb('evaluation_trace').$type<readonly PersistedEvaluationTraceEntry[]>(),
    type: text('type').notNull().$type<StepType>(),
    config: jsonb('config').notNull().$type<Record<string, unknown>>(),
    condition: jsonb('condition').$type<WorkflowExpression>(),
    configPlan: jsonb('config_plan').$type<StepConfigDispatchPlan>(),
    authoredConfig: jsonb('authored_config').$type<Record<string, unknown>>(),
    error: jsonb('error').$type<Record<string, unknown>>(),
    position: integer('position').notNull(),
    version: integer('version').notNull().default(1),
    // Execution-attempt identity, distinct from the optimistic `version` counter.
    // Starts at 1 and is bumped only on durable rewind.
    currentAttempt: integer('current_attempt').notNull().default(1),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    index('workflows_steps_job_execution_id_idx').on(table.jobExecutionId),
    uniqueIndex('workflows_steps_id_job_execution_id_uq').on(table.id, table.jobExecutionId),
    check('workflows_steps_current_attempt_positive_ck', sql`${table.currentAttempt} > 0`),
    foreignKey({
      name: 'workflows_steps_job_execution_id_workflows_job_executions_id_fk',
      columns: [table.jobExecutionId],
      foreignColumns: [jobExecutions.id],
    }).onDelete('cascade'),
  ],
);

export type StepDb = typeof steps.$inferSelect;
export type StepCreateDb = typeof steps.$inferInsert;

export function toStep(row: StepDb): Step {
  return {
    id: row.id,
    jobExecutionId: row.jobExecutionId,
    key: row.key,
    name: row.name,
    sourceLocation: row.sourceLocation ?? null,
    status: row.status,
    statusReason: toStepStatusReason(row.statusReason),
    evaluationTrace: row.evaluationTrace ?? null,
    type: row.type,
    config: row.config as Record<string, unknown>,
    condition: (row.condition as WorkflowExpression) ?? null,
    configPlan: row.configPlan ?? null,
    authoredConfig: (row.authoredConfig as Record<string, unknown>) ?? null,
    error: (row.error as Record<string, unknown>) ?? null,
    position: row.position,
    version: row.version,
    currentAttempt: row.currentAttempt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
