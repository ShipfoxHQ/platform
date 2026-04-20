import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {index, jsonb, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const pendingJobs = pgTable(
  'pending_jobs',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    jobId: uuid('job_id').notNull().unique(),
    runId: uuid('run_id').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    index('runners_pending_jobs_created_idx').on(table.createdAt),
    index('runners_pending_jobs_workspace_created_idx').on(table.workspaceId, table.createdAt),
  ],
);

export type PendingJobDb = typeof pendingJobs.$inferSelect;
export type PendingJobInsertDb = typeof pendingJobs.$inferInsert;
