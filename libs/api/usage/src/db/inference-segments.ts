import {
  type InferenceSegmentInputDto,
  type InferenceSegmentUsageDto,
  inferenceSegmentInputSchema,
  MAX_INFERENCE_SEGMENTS_BATCH_SIZE,
  MAX_USAGE_REPLAY_LIMIT,
  USAGE_INFERENCE_SEGMENT_RECORDED,
  type UsageEventMap,
} from '@shipfox/api-usage-dto';
import {writeOutboxEvents} from '@shipfox/node-outbox';
import {and, asc, eq, gt, gte, isNotNull, or, sql} from 'drizzle-orm';
import {db, type Transaction} from './db.js';
import {usageInferenceSegments} from './schema/inference-segments.js';
import {usageOutbox} from './schema/outbox.js';

export type UsageInferenceSegmentRow = typeof usageInferenceSegments.$inferSelect;

export interface InferenceSegmentUsageCursor {
  recordedAt: Date;
  id: string;
}

export interface ListInferenceSegmentsParams {
  workspaceId?: string | undefined;
  since?: Date | undefined;
  cursor?: InferenceSegmentUsageCursor | undefined;
  limit?: number | undefined;
}

export interface ListInferenceSegmentsResult {
  segments: UsageInferenceSegmentRow[];
  nextCursor: InferenceSegmentUsageCursor | null;
}

export function recordInferenceSegments(params: {
  segments: readonly InferenceSegmentInputDto[];
  now?: Date;
}): Promise<{recorded: number; duplicates: number}> {
  if (params.segments.length > MAX_INFERENCE_SEGMENTS_BATCH_SIZE) {
    throw new Error(
      `Inference segment batches cannot contain more than ${MAX_INFERENCE_SEGMENTS_BATCH_SIZE} segments`,
    );
  }
  if (params.segments.length === 0) {
    return Promise.resolve({recorded: 0, duplicates: 0});
  }
  const segments = params.segments.map((segment) => inferenceSegmentInputSchema.parse(segment));

  return db().transaction(async (tx) => {
    const events: Array<{
      type: typeof USAGE_INFERENCE_SEGMENT_RECORDED;
      orderingKey: string;
      payload: ReturnType<typeof toRecordedInferenceSegment>;
    }> = [];
    let duplicates = 0;
    const recordedAt = params.now ?? new Date();

    const segmentKeys = [...new Set(segments.map((segment) => segment.segmentKey))].sort();
    for (const segmentKey of segmentKeys) {
      await lockSegment(tx, segmentKey);
    }

    for (const segment of segments) {
      const [existing] = await tx
        .select()
        .from(usageInferenceSegments)
        .where(eq(usageInferenceSegments.segmentKey, segment.segmentKey));
      if (existing) {
        duplicates += 1;
        continue;
      }

      const [row] = await tx
        .insert(usageInferenceSegments)
        .values({
          segmentKey: segment.segmentKey,
          source: segment.source,
          workspaceId: segment.workspaceId,
          projectId: segment.projectId,
          workflowRunId: segment.workflowRunId,
          workflowRunAttemptId: segment.workflowRunAttemptId,
          jobId: segment.jobId,
          jobExecutionId: segment.jobExecutionId,
          stepId: segment.stepId,
          stepAttemptId: segment.stepAttemptId,
          upstream: segment.upstream,
          model: segment.model,
          dialect: segment.dialect,
          windowStart: new Date(segment.windowStart),
          windowEnd: new Date(segment.windowEnd),
          requestCount: segment.requestCount,
          inputTokens: segment.inputTokens,
          outputTokens: segment.outputTokens,
          cacheCreationTokens: segment.cacheCreationTokens,
          cacheReadTokens: segment.cacheReadTokens,
          reasoningTokens: segment.reasoningTokens,
          webSearchRequests: segment.webSearchRequests,
          recordedAt,
        })
        .returning();
      if (!row) throw new Error('Usage inference segment was not inserted');
      events.push({
        type: USAGE_INFERENCE_SEGMENT_RECORDED,
        orderingKey: row.stepAttemptId,
        payload: toRecordedInferenceSegment(row),
      });
    }

    await writeOutboxEvents<UsageEventMap>(tx, usageOutbox, events);
    return {recorded: events.length, duplicates};
  });
}

export async function listInferenceSegments(
  params: ListInferenceSegmentsParams,
): Promise<ListInferenceSegmentsResult> {
  const limit = params.limit ?? MAX_USAGE_REPLAY_LIMIT;
  const conditions = [isNotNull(usageInferenceSegments.recordedAt)];
  if (params.workspaceId) {
    conditions.push(eq(usageInferenceSegments.workspaceId, params.workspaceId));
  }
  if (params.since) conditions.push(gte(usageInferenceSegments.recordedAt, params.since));
  if (params.cursor) {
    const cursorCondition = or(
      gt(usageInferenceSegments.recordedAt, params.cursor.recordedAt),
      and(
        eq(usageInferenceSegments.recordedAt, params.cursor.recordedAt),
        gt(usageInferenceSegments.id, params.cursor.id),
      ),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }

  const rows = await db()
    .select()
    .from(usageInferenceSegments)
    .where(and(...conditions))
    .orderBy(asc(usageInferenceSegments.recordedAt), asc(usageInferenceSegments.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = rows.length > limit ? page.at(-1) : undefined;
  return {
    segments: page,
    nextCursor: last ? {recordedAt: last.recordedAt, id: last.id} : null,
  };
}

export function listInferenceSegmentsForRun(params: {
  workspaceId: string;
  workflowRunId: string;
}): Promise<UsageInferenceSegmentRow[]> {
  return db()
    .select()
    .from(usageInferenceSegments)
    .where(
      and(
        eq(usageInferenceSegments.workspaceId, params.workspaceId),
        eq(usageInferenceSegments.workflowRunId, params.workflowRunId),
      ),
    )
    .orderBy(
      asc(usageInferenceSegments.jobExecutionId),
      asc(usageInferenceSegments.stepAttemptId),
      asc(usageInferenceSegments.upstream),
      asc(usageInferenceSegments.model),
      asc(usageInferenceSegments.windowStart),
      asc(usageInferenceSegments.id),
    );
}

export function listInferenceSegmentsForJobExecution(params: {
  workspaceId: string;
  jobExecutionId: string;
}): Promise<UsageInferenceSegmentRow[]> {
  return db()
    .select()
    .from(usageInferenceSegments)
    .where(
      and(
        eq(usageInferenceSegments.workspaceId, params.workspaceId),
        eq(usageInferenceSegments.jobExecutionId, params.jobExecutionId),
      ),
    )
    .orderBy(
      asc(usageInferenceSegments.stepAttemptId),
      asc(usageInferenceSegments.upstream),
      asc(usageInferenceSegments.model),
      asc(usageInferenceSegments.windowStart),
      asc(usageInferenceSegments.id),
    );
}

export function toRecordedInferenceSegment(
  row: UsageInferenceSegmentRow,
): InferenceSegmentUsageDto & {version: 1} {
  return {
    version: 1,
    ...toInferenceSegmentUsage(row),
  };
}

export function toInferenceSegmentUsage(row: UsageInferenceSegmentRow): InferenceSegmentUsageDto {
  return {
    id: row.id,
    segmentKey: row.segmentKey,
    source: row.source,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    workflowRunId: row.workflowRunId,
    workflowRunAttemptId: row.workflowRunAttemptId,
    jobId: row.jobId,
    jobExecutionId: row.jobExecutionId,
    stepId: row.stepId,
    stepAttemptId: row.stepAttemptId,
    upstream: row.upstream,
    model: row.model,
    dialect: row.dialect,
    windowStart: row.windowStart.toISOString(),
    windowEnd: row.windowEnd.toISOString(),
    requestCount: row.requestCount,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    cacheReadTokens: row.cacheReadTokens,
    reasoningTokens: row.reasoningTokens,
    webSearchRequests: row.webSearchRequests,
    recordedAt: row.recordedAt.toISOString(),
  };
}

async function lockSegment(tx: Transaction, segmentKey: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${segmentKey}))`);
}
