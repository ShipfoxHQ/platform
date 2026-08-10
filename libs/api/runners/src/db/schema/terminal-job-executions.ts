import {timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const terminalJobExecutions = pgTable('terminal_job_executions', {
  jobExecutionId: uuid('job_execution_id').primaryKey(),
  createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
});
