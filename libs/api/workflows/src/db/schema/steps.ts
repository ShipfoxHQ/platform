import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, integer, jsonb, pgEnum, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import type {Step} from '#core/entities/step.js';
import {pgTable} from './common.js';
import {jobs} from './jobs.js';

export const stepStatusEnum = pgEnum('workflows_step_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const steps = pgTable(
  'steps',
  {
    id: uuidv7PrimaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    name: text('name'),
    status: stepStatusEnum('status').notNull().default('pending'),
    type: text('type').notNull(),
    config: jsonb('config').notNull().$type<Record<string, unknown>>(),
    output: jsonb('output').$type<Record<string, unknown>>(),
    error: jsonb('error').$type<Record<string, unknown>>(),
    position: integer('position').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [index('workflows_steps_job_id_idx').on(table.jobId)],
);

export type StepDb = typeof steps.$inferSelect;
export type StepCreateDb = typeof steps.$inferInsert;

export function toStep(row: StepDb): Step {
  return {
    id: row.id,
    jobId: row.jobId,
    name: row.name,
    status: row.status,
    type: row.type,
    config: row.config as Record<string, unknown>,
    output: (row.output as Record<string, unknown>) ?? null,
    error: (row.error as Record<string, unknown>) ?? null,
    position: row.position,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
