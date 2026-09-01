import type {SessionViewLifecycleRow, SessionViewRow} from '@shipfox/api-logs-dto';
import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {AttemptStream} from '#core/entities/attempt-stream.js';
import {pgTable} from './common.js';

/**
 * One stream per (job, step, attempt). Identity is scoped by `job_id` (from the
 * lease), so a lease can only ever reach its own job's streams; cross-job log
 * injection is structurally impossible. `workspace_id`, `project_id`, and `workflow_run_attempt_id`
 * are stamped from the lease at create time; they are functionally determined by
 * `job_id` via workflows FKs, so they are denormalized here for self-contained
 * authorization (per-project read filtering, audit) without joining back to
 * workflows. `committed_length` is the active writer's offset-CAS axis (raw or normalized NDJSON
 * bytes the server has durably accepted from the runner or server-origin writer).
 *
 * `truncated` is an out-of-band terminal flag set when the timeout sweep
 * force-closes a stream the runner never ended; the `AttemptStream` entity is the
 * canonical reference for what it means.
 * `line_count` is populated when compaction publishes the cold objects, so hot reads can omit
 * the count while cold reads can report it without scanning the full stream.
 * `compaction_reconciled_at` throttles orphan cleanup without relying on `updated_at`, which late
 * appends can refresh even after a stream is closed.
 *
 * Per-row `committed_length` and `declared_total_bytes` are bounded by the
 * per-job budget, so `mode: 'number'` is safe on the hot path. Any cross-row
 * aggregate (workspace or system-wide totals) MUST read as bigint at the
 * query site: the global sum is unbounded and would silently lose precision
 * past 2^53 as a JS number.
 */
export const attemptStreams = pgTable(
  'attempt_streams',
  {
    id: uuidv7PrimaryKey(),
    jobId: uuid('job_id').notNull(),
    stepId: uuid('step_id').notNull(),
    attempt: integer('attempt').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    workflowRunAttemptId: uuid('workflow_run_attempt_id').notNull(),
    committedLength: bigint('committed_length', {mode: 'number'}).notNull().default(0),
    state: text('state', {enum: ['open', 'closed']})
      .notNull()
      .default('open'),
    closeReason: text('close_reason', {enum: ['declared', 'timeout']}),
    declaredTotalBytes: bigint('declared_total_bytes', {mode: 'number'}),
    claudeHasInit: boolean('claude_has_init').notNull().default(false),
    claudeSessionId: text('claude_session_id'),
    claudeTurn: integer('claude_turn').notNull().default(0),
    claudePendingResult: jsonb('claude_pending_result').$type<SessionViewLifecycleRow>(),
    claudePendingToolRows: jsonb('claude_pending_tool_rows').$type<SessionViewRow[]>(),
    truncated: boolean('truncated').notNull().default(false),
    lineCount: bigint('line_count', {mode: 'number'}),
    compactionReconciledAt: timestamp('compaction_reconciled_at', {withTimezone: true}),
    objectKey: text('object_key'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
    closedAt: timestamp('closed_at', {withTimezone: true}),
  },
  (table) => [
    uniqueIndex('logs_attempt_streams_identity_unique').on(
      table.jobId,
      table.stepId,
      table.attempt,
    ),
    // The session read path looks up a stream by (step, attempt) without the job id, so the
    // identity unique (which leads with job_id) can't serve it. This index keeps that lookup
    // off a sequential scan as the table grows.
    index('logs_attempt_streams_step_attempt_idx').on(table.stepId, table.attempt),
    // Timeout-close sweeps an open job's streams by job_id; the partial index keeps
    // it off the closed tail.
    index('logs_attempt_streams_open_by_job_idx').on(table.jobId).where(sql`"state" = 'open'`),
    // Open-age reaping needs an index that stays off the closed tail; created_at is
    // immutable, so appends do not churn it.
    index('logs_attempt_streams_open_age_idx').on(table.createdAt).where(sql`"state" = 'open'`),
    // Retention scans closed streams by close age; partial so it never carries the
    // open (in-flight) set.
    index('logs_attempt_streams_retention_idx').on(table.closedAt).where(sql`"state" = 'closed'`),
    // Reconcile re-drives closed streams that never got an object key.
    index('logs_attempt_streams_uncompacted_idx')
      .on(table.closedAt)
      .where(sql`"state" = 'closed' and "object_key" is null`),
    // Compaction reconciliation scans durable closed streams by close age and its cooldown.
    index('logs_attempt_streams_compaction_reconciliation_idx')
      .on(table.closedAt, table.compactionReconciledAt)
      .where(sql`"state" = 'closed' and "object_key" is not null`),
  ],
);

export type AttemptStreamDb = typeof attemptStreams.$inferSelect;
export type AttemptStreamInsertDb = typeof attemptStreams.$inferInsert;

export function toAttemptStream(row: AttemptStreamDb): AttemptStream {
  return {
    id: row.id,
    jobId: row.jobId,
    stepId: row.stepId,
    attempt: row.attempt,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    workflowRunAttemptId: row.workflowRunAttemptId,
    committedLength: row.committedLength,
    state: row.state,
    closeReason: row.closeReason,
    declaredTotalBytes: row.declaredTotalBytes,
    claudeHasInit: row.claudeHasInit,
    claudeSessionId: row.claudeSessionId,
    claudeTurn: row.claudeTurn,
    claudePendingResult: row.claudePendingResult ?? null,
    claudePendingToolRows: row.claudePendingToolRows ?? [],
    truncated: row.truncated,
    lineCount: row.lineCount ?? null,
    objectKey: row.objectKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    closedAt: row.closedAt,
  };
}
