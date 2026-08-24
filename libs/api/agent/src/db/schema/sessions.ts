import type {Harness} from '@shipfox/api-agent-dto';
import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {bigint, integer, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import type {AgentSession} from '#core/entities/agent-session.js';
import {pgTable} from './common.js';

/**
 * Registry of named agent sessions, scoped to one workflow run attempt:
 * `(workflow_run_attempt_id, key)` is unique, and reruns create fresh rows
 * (`carried_from_session_id` records the provenance). `workspace_id` and
 * `project_id` are denormalized scope for self-contained authorization, as on
 * log streams; every other foreign id is a plain column with no cross-module
 * foreign key.
 *
 * `head_segment` is both the monotonic segment counter and the commit CAS
 * token; `head_committed_by_attempt` discriminates the idempotent-retry ack.
 * `claimed_by_step_attempt`/`claimed_at` mark the exclusive resume writer and
 * are the `FOR UPDATE` contention axis. `version` is an optimistic-lock
 * counter, bumped on every mutation.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    workflowRunAttemptId: uuid('workflow_run_attempt_id').notNull(),
    key: text('key').notNull(),
    harness: text('harness', {enum: ['pi', 'claude']}).notNull(),
    harnessSessionId: text('harness_session_id'),
    headSegment: integer('head_segment').notNull().default(0),
    headObjectKey: text('head_object_key'),
    headSizeBytes: bigint('head_size_bytes', {mode: 'number'}),
    headCommittedByAttempt: uuid('head_committed_by_attempt'),
    headRepoRef: text('head_repo_ref'),
    claimedByStepAttempt: uuid('claimed_by_step_attempt'),
    claimedAt: timestamp('claimed_at', {withTimezone: true}),
    carriedFromSessionId: uuid('carried_from_session_id'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_sessions_run_key_unique').on(table.workflowRunAttemptId, table.key),
  ],
);

export type AgentSessionDb = typeof sessions.$inferSelect;
export type AgentSessionInsertDb = typeof sessions.$inferInsert;

export function toAgentSession(row: AgentSessionDb): AgentSession {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    workflowRunAttemptId: row.workflowRunAttemptId,
    key: row.key,
    harness: row.harness as Harness,
    harnessSessionId: row.harnessSessionId,
    headSegment: row.headSegment,
    headObjectKey: row.headObjectKey,
    headSizeBytes: row.headSizeBytes,
    headCommittedByAttempt: row.headCommittedByAttempt,
    headRepoRef: row.headRepoRef,
    claimedByStepAttempt: row.claimedByStepAttempt,
    claimedAt: row.claimedAt,
    carriedFromSessionId: row.carriedFromSessionId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
