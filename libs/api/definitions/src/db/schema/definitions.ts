import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {jsonb, pgEnum, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {WorkflowDefinition, WorkflowSpec} from '#core/entities/definition.js';
import {pgTable} from './common.js';

export const definitionSourceEnum = pgEnum('definitions_source', ['manual', 'vcs']);

export const workflowDefinitions = pgTable(
  'workflow_definitions',
  {
    id: uuidv7PrimaryKey(),
    projectId: uuid('project_id').notNull(),
    configPath: text('config_path'),
    source: definitionSourceEnum('source').notNull().default('manual'),
    sha: text('sha'),
    ref: text('ref'),
    name: text('name').notNull(),
    definition: jsonb('definition').notNull().$type<WorkflowSpec>(),
    fetchedAt: timestamp('fetched_at', {withTimezone: true}).notNull().defaultNow(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('definitions_wd_project_id_config_path_unique')
      .on(table.projectId, table.configPath)
      .where(sql`"config_path" IS NOT NULL`),
    uniqueIndex('definitions_wd_sha_lookup')
      .on(table.projectId, table.sha, table.configPath)
      .where(sql`"sha" IS NOT NULL`),
    uniqueIndex('definitions_wd_ref_lookup')
      .on(table.projectId, table.ref, table.configPath)
      .where(sql`"ref" IS NOT NULL`),
  ],
);

export type DefinitionDb = typeof workflowDefinitions.$inferSelect;
export type DefinitionCreateDb = typeof workflowDefinitions.$inferInsert;
export type DefinitionUpdateDb = Partial<DefinitionCreateDb>;

export function toDefinition(row: DefinitionDb): WorkflowDefinition {
  return {
    id: row.id,
    projectId: row.projectId,
    configPath: row.configPath,
    source: row.source,
    sha: row.sha,
    ref: row.ref,
    name: row.name,
    definition: row.definition as WorkflowSpec,
    fetchedAt: row.fetchedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
