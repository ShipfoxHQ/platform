import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {check, index, jsonb, pgEnum, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {
  WorkflowDefinition,
  WorkflowDefinitionPayload,
} from '#core/entities/workflow-definition.js';
import {pgTable} from './common.js';
import {workflowWorkflows} from './workflows.js';

export const definitionSourceEnum = pgEnum('definitions_source', ['manual', 'vcs']);

export const workflowDefinitions = pgTable(
  'workflow_definitions',
  {
    id: uuidv7PrimaryKey(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflowWorkflows.id),
    projectId: uuid('project_id').notNull(),
    configPath: text('config_path'),
    source: definitionSourceEnum('source').notNull().default('manual'),
    sha: text('sha'),
    ref: text('ref'),
    name: text('name').notNull(),
    definition: jsonb('definition').notNull().$type<WorkflowDefinitionPayload>(),
    contentHash: text('content_hash'),
    fetchedAt: timestamp('fetched_at', {withTimezone: true}).notNull().defaultNow(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', {withTimezone: true}),
  },
  (table) => [
    // Manual definitions only (no ref, no sha); VCS uniqueness is sha_lookup/ref_lookup.
    // A source-agnostic predicate here collides VCS upserts on a non-arbiter index. ENG-659.
    uniqueIndex('definitions_wd_manual_unique')
      .on(table.projectId, table.configPath)
      .where(sql`"config_path" IS NOT NULL AND "ref" IS NULL AND "sha" IS NULL`),
    uniqueIndex('definitions_wd_sha_lookup')
      .on(table.projectId, table.sha, table.configPath)
      .where(sql`"sha" IS NOT NULL`),
    uniqueIndex('definitions_wd_ref_lookup')
      .on(table.projectId, table.ref, table.configPath)
      .where(sql`"ref" IS NOT NULL`),
    index('definitions_wd_project_name_id_idx')
      .on(table.projectId, table.name, table.id)
      .where(sql`"deleted_at" IS NULL`),
    // Binds source to its git coordinates so the partial indexes above stay
    // unambiguous: vcs rows carry a ref or sha; manual rows carry neither.
    check(
      'definitions_wd_source_ref_sha_consistent',
      sql`("source" = 'vcs') = ("ref" IS NOT NULL OR "sha" IS NOT NULL)`,
    ),
  ],
);

export type DefinitionDb = typeof workflowDefinitions.$inferSelect;
export type DefinitionCreateDb = typeof workflowDefinitions.$inferInsert;
export type DefinitionUpdateDb = Partial<DefinitionCreateDb>;

export function toDefinition(row: DefinitionDb): WorkflowDefinition {
  return {
    id: row.id,
    workflowId: row.workflowId,
    projectId: row.projectId,
    configPath: row.configPath,
    source: row.source,
    sha: row.sha,
    ref: row.ref,
    name: row.name,
    definition: row.definition.document,
    document: row.definition.document,
    model: row.definition.model,
    sourceSnapshot: row.definition.sourceSnapshot ?? null,
    contentHash: row.contentHash,
    fetchedAt: row.fetchedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}
