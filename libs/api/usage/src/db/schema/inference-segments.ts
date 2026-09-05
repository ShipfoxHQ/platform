import {inferenceSegmentDialects} from '@shipfox/api-usage-dto';
import {sql} from 'drizzle-orm';
import {bigint, index, integer, text, timestamp, uniqueIndex, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const usageInferenceSegments = pgTable(
  'inference_segments',
  {
    id: uuid('id').notNull().default(sql`uuidv7()`),
    segmentKey: text('segment_key').notNull(),
    source: text('source', {enum: ['gateway']}).notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    workflowRunId: uuid('workflow_run_id').notNull(),
    workflowRunAttemptId: uuid('workflow_run_attempt_id').notNull(),
    jobId: uuid('job_id').notNull(),
    jobExecutionId: uuid('job_execution_id').notNull(),
    stepId: uuid('step_id').notNull(),
    stepAttemptId: uuid('step_attempt_id').notNull(),
    upstream: text('upstream').notNull(),
    model: text('model').notNull(),
    dialect: text('dialect', {enum: inferenceSegmentDialects}).notNull(),
    windowStart: timestamp('window_start', {withTimezone: true}).notNull(),
    windowEnd: timestamp('window_end', {withTimezone: true}).notNull(),
    requestCount: bigint('request_count', {mode: 'number'}).notNull(),
    inputTokens: bigint('input_tokens', {mode: 'number'}).notNull(),
    outputTokens: bigint('output_tokens', {mode: 'number'}).notNull(),
    cacheCreationTokens: bigint('cache_creation_tokens', {mode: 'number'}).notNull(),
    cacheReadTokens: bigint('cache_read_tokens', {mode: 'number'}).notNull(),
    reasoningTokens: bigint('reasoning_tokens', {mode: 'number'}).notNull(),
    webSearchRequests: integer('web_search_requests').notNull().default(0),
    recordedAt: timestamp('recorded_at', {withTimezone: true}).notNull(),
  },
  (table) => [
    uniqueIndex('usage_inference_segments_segment_key_recorded_unique').on(
      table.segmentKey,
      table.recordedAt,
    ),
    index('usage_inference_segments_workspace_recorded_idx').on(
      table.workspaceId,
      table.recordedAt,
    ),
    index('usage_inference_segments_recorded_id_idx').on(table.recordedAt, table.id),
    index('usage_inference_segments_workflow_run_idx').on(table.workflowRunId),
    index('usage_inference_segments_job_execution_idx').on(table.jobExecutionId),
    index('usage_inference_segments_step_attempt_idx').on(table.stepAttemptId),
  ],
);

export type UsageInferenceSegmentDb = typeof usageInferenceSegments.$inferSelect;
export type UsageInferenceSegmentInsertDb = typeof usageInferenceSegments.$inferInsert;
