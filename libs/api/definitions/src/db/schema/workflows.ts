import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const workflowWorkflows = pgTable(
  'workflows',
  {
    id: uuidv7PrimaryKey(),
    projectId: uuid('project_id').notNull(),
    configPath: text('config_path').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('definitions_workflows_project_path_unique').on(table.projectId, table.configPath),
  ],
);

export type WorkflowDb = typeof workflowWorkflows.$inferSelect;
export type WorkflowCreateDb = typeof workflowWorkflows.$inferInsert;
