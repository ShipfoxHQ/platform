import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const runningJobs = pgTable('running_jobs', {
  id: uuidv7PrimaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  jobId: uuid('job_id').notNull().unique(),
  runId: uuid('run_id').notNull(),
  runnerTokenId: uuid('runner_token_id').notNull(),
  startedAt: timestamp('started_at', {withTimezone: true}).notNull().defaultNow(),
  lastHeartbeatAt: timestamp('last_heartbeat_at', {withTimezone: true}).notNull().defaultNow(),
});

export type RunningJobDb = typeof runningJobs.$inferSelect;
export type RunningJobInsertDb = typeof runningJobs.$inferInsert;
