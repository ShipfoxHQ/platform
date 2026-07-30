import {
  readPersistedWorkflowModel,
  type WorkflowModel,
  type WorkflowModelSnapshot,
} from '@shipfox/api-definitions-dto';
import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {check, integer, jsonb, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {AgentToolMaterializationSnapshot} from '#core/agent-tools.js';
import type {WorkflowRunAttempt} from '#core/entities/workflow-run-attempt.js';
import {pgTable} from './common.js';
import {workflowRunRerunModeEnum, workflowRunStatusEnum, workflowRuns} from './workflow-runs.js';

export const workflowRunAttempts = pgTable(
  'workflow_run_attempts',
  {
    id: uuidv7PrimaryKey(),
    workflowRunId: uuid('workflow_run_id')
      .notNull()
      .references(() => workflowRuns.id, {onDelete: 'cascade'}),
    attempt: integer('attempt').notNull(),
    status: workflowRunStatusEnum('status').notNull().default('pending'),
    rerunMode: workflowRunRerunModeEnum('rerun_mode'),
    rerunByUserId: uuid('rerun_by_user_id'),
    model: jsonb('model').$type<WorkflowModel | WorkflowModelSnapshot>(),
    vars: jsonb('vars').$type<Record<string, string>>(),
    agentToolMaterialization: jsonb(
      'agent_tool_materialization',
    ).$type<AgentToolMaterializationSnapshot>(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
    startedAt: timestamp('started_at', {withTimezone: true}),
    finishedAt: timestamp('finished_at', {withTimezone: true}),
  },
  (table) => [
    uniqueIndex('workflows_wra_workflow_run_attempt_unique').on(table.workflowRunId, table.attempt),
    check('workflows_wra_attempt_positive_ck', sql`${table.attempt} > 0`),
    uniqueIndex('workflows_wra_one_active_attempt_unique')
      .on(table.workflowRunId)
      .where(sql`${table.status} in ('pending', 'running')`),
  ],
);

export type WorkflowRunAttemptDb = typeof workflowRunAttempts.$inferSelect;
export type WorkflowRunAttemptCreateDb = typeof workflowRunAttempts.$inferInsert;

export function toWorkflowRunAttempt(row: WorkflowRunAttemptDb): WorkflowRunAttempt {
  return {
    id: row.id,
    workflowRunId: row.workflowRunId,
    attempt: row.attempt,
    status: row.status,
    rerunMode: row.rerunMode ?? null,
    rerunByUserId: row.rerunByUserId,
    model: row.model === null ? null : readPersistedWorkflowModel(row.model),
    vars: row.vars ?? null,
    agentToolMaterialization: row.agentToolMaterialization ?? null,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}
