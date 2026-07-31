import {integer, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const workflowRunCounters = pgTable(
  'workflow_run_counters',
  {
    definitionId: uuid('definition_id').notNull(),
    nextNumber: integer('next_number').notNull(),
  },
  (table) => [uniqueIndex('workflows_wrrc_definition_id_unique').on(table.definitionId)],
);

export type WorkflowRunCounterDb = typeof workflowRunCounters.$inferSelect;
