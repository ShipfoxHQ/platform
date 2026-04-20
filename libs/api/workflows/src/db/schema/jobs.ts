import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, integer, jsonb, pgEnum, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import type {Job} from '#core/entities/job.js';
import {pgTable} from './common.js';
import {workflowRuns} from './workflow-runs.js';

export const jobStatusEnum = pgEnum('workflows_job_status', [
  'pending',
  'waiting_for_dependencies',
  'ready',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'awaiting_manual',
]);

export const jobs = pgTable(
  'jobs',
  {
    id: uuidv7PrimaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => workflowRuns.id),
    name: text('name').notNull(),
    status: jobStatusEnum('status').notNull().default('pending'),
    dependencies: jsonb('dependencies').notNull().$type<string[]>(),
    runner: jsonb('runner').$type<string[]>(),
    position: integer('position').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [index('workflows_jobs_run_id_idx').on(table.runId)],
);

export type JobDb = typeof jobs.$inferSelect;
export type JobCreateDb = typeof jobs.$inferInsert;

export function toJob(row: JobDb): Job {
  return {
    id: row.id,
    runId: row.runId,
    name: row.name,
    status: row.status,
    dependencies: row.dependencies as string[],
    runner: row.runner as string[] | null,
    position: row.position,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
