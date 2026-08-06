import {type AnnotationStyleDto, READ_ANNOTATIONS_MAX_LIMIT} from '@shipfox/annotations-dto';
import {and, asc, count, eq, gt, inArray, or, type SQL, sql} from 'drizzle-orm';
import type {Annotation} from '#core/entities/annotation.js';
import {db} from './db.js';
import {annotations, toAnnotation} from './schema/annotations.js';

export const DEFAULT_ANNOTATIONS_READ_LIMIT = READ_ANNOTATIONS_MAX_LIMIT;

export interface ListAnnotationsForRunAttemptParams {
  workflowRunId: string;
  workflowRunAttempt: number;
  workspaceIds: readonly string[];
  jobExecutionId?: string | undefined;
  after?: {sequence: number; id: string} | undefined;
  limit?: number | undefined;
}

export interface ListAnnotationsForRunAttemptResult {
  annotations: Annotation[];
  hasMore: boolean;
  nextCursor: {sequence: number; id: string} | null;
}

export async function listAnnotationsForRunAttempt(
  params: ListAnnotationsForRunAttemptParams,
): Promise<ListAnnotationsForRunAttemptResult> {
  if (params.workspaceIds.length === 0) return {annotations: [], hasMore: false, nextCursor: null};

  const limit = params.limit ?? DEFAULT_ANNOTATIONS_READ_LIMIT;

  const conditions: SQL[] = [
    eq(annotations.workflowRunId, params.workflowRunId),
    eq(annotations.workflowRunAttempt, params.workflowRunAttempt),
    inArray(annotations.workspaceId, [...params.workspaceIds]),
  ];
  if (params.jobExecutionId) {
    conditions.push(eq(annotations.jobExecutionId, params.jobExecutionId));
  }
  if (params.after) {
    const cursorCondition = or(
      gt(annotations.sequence, params.after.sequence),
      and(eq(annotations.sequence, params.after.sequence), gt(annotations.id, params.after.id)),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }

  const rows = await db()
    .select()
    .from(annotations)
    .where(and(...conditions))
    .orderBy(asc(annotations.sequence), asc(annotations.id))
    .limit(limit + 1);

  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);

  return {
    annotations: pageRows.map(toAnnotation),
    hasMore: rows.length > limit,
    nextCursor: rows.length > limit && last ? {sequence: last.sequence, id: last.id} : null,
  };
}

export interface AnnotationSummary {
  total: number;
  error: number;
  warning: number;
  info: number;
  success: number;
  stepCounts: Array<{
    originStepId: string;
    originStepAttempt: number;
    total: number;
  }>;
}

export interface SummarizeAnnotationsForRunAttemptParams {
  workflowRunId: string;
  workflowRunAttempt: number;
  workspaceIds: readonly string[];
  jobExecutionId?: string | undefined;
}

/** Count annotation styles without reading any annotation bodies. */
export async function summarizeAnnotationsForRunAttempt(
  params: SummarizeAnnotationsForRunAttemptParams,
): Promise<AnnotationSummary> {
  const summary: AnnotationSummary = {
    total: 0,
    error: 0,
    warning: 0,
    info: 0,
    success: 0,
    stepCounts: [],
  };
  if (params.workspaceIds.length === 0) return summary;

  const conditions: SQL[] = [
    eq(annotations.workflowRunId, params.workflowRunId),
    eq(annotations.workflowRunAttempt, params.workflowRunAttempt),
    inArray(annotations.workspaceId, [...params.workspaceIds]),
  ];
  if (params.jobExecutionId) {
    conditions.push(eq(annotations.jobExecutionId, params.jobExecutionId));
  }

  const {rows, stepRows} = await db().transaction(async (tx) => {
    // Both aggregates must observe the same committed state. READ COMMITTED would allow a
    // concurrent annotation write between these selects, producing contradictory totals.
    await tx.execute(sql`set transaction isolation level repeatable read, read only`);

    const rows = await tx
      .select({style: annotations.style, count: count()})
      .from(annotations)
      .where(and(...conditions))
      .groupBy(annotations.style);

    const stepRows = await tx
      .select({
        originStepId: annotations.originStepId,
        originStepAttempt: annotations.originStepAttempt,
        total: count(),
      })
      .from(annotations)
      .where(and(...conditions))
      .groupBy(annotations.originStepId, annotations.originStepAttempt)
      .orderBy(asc(annotations.originStepId), asc(annotations.originStepAttempt));

    return {rows, stepRows};
  });

  for (const row of rows) {
    const value = Number(row.count);
    summary.total += value;
    if (row.style !== 'default') summary[row.style] += value;
  }

  summary.stepCounts = stepRows.map((row) => ({
    originStepId: row.originStepId,
    originStepAttempt: row.originStepAttempt,
    total: Number(row.total),
  }));

  return summary;
}

export interface StoredAnnotation {
  id: string;
  context: string;
  style: AnnotationStyleDto;
  body: string;
  bodyBytes: number;
  sequence: number;
}

export interface CreateAnnotationParams {
  workspaceId: string;
  projectId: string;
  workflowRunId: string;
  workflowRunAttempt: number;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  originStepId: string;
  originStepAttempt: number;
  context: string;
  style: AnnotationStyleDto;
  body: string;
  bodyBytes: number;
  sequence: number;
}

export interface UpdateAnnotationParams {
  id: string;
  originStepId: string;
  originStepAttempt: number;
  style: AnnotationStyleDto;
  body: string;
  bodyBytes: number;
}

export interface AnnotationWriteRepository {
  loadCurrentAnnotations(jobExecutionId: string): Promise<Map<string, StoredAnnotation>>;
  removeAnnotation(jobExecutionId: string, context: string): Promise<void>;
  createAnnotation(params: CreateAnnotationParams): Promise<StoredAnnotation>;
  updateAnnotation(params: UpdateAnnotationParams): Promise<StoredAnnotation>;
}

export function withAnnotationLock<T>(
  jobExecutionId: string,
  work: (repo: AnnotationWriteRepository) => Promise<T>,
): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${jobExecutionId}))`);

    const repo: AnnotationWriteRepository = {
      loadCurrentAnnotations: async (lockedJobExecutionId) => {
        const rows = await tx
          .select({
            id: annotations.id,
            context: annotations.context,
            style: annotations.style,
            body: annotations.body,
            bodyBytes: annotations.bodyBytes,
            sequence: annotations.sequence,
          })
          .from(annotations)
          .where(eq(annotations.jobExecutionId, lockedJobExecutionId));

        return new Map(rows.map((row) => [row.context, row]));
      },
      removeAnnotation: async (lockedJobExecutionId, context) => {
        await tx
          .delete(annotations)
          .where(
            and(
              eq(annotations.jobExecutionId, lockedJobExecutionId),
              eq(annotations.context, context),
            ),
          );
      },
      createAnnotation: async (params) => {
        const [row] = await tx.insert(annotations).values(params).returning({
          id: annotations.id,
          context: annotations.context,
          style: annotations.style,
          body: annotations.body,
          bodyBytes: annotations.bodyBytes,
          sequence: annotations.sequence,
        });

        if (!row) throw new Error('createAnnotation: insert returned no row');
        return row;
      },
      updateAnnotation: async (params) => {
        const [row] = await tx
          .update(annotations)
          .set({
            originStepId: params.originStepId,
            originStepAttempt: params.originStepAttempt,
            style: params.style,
            body: params.body,
            bodyBytes: params.bodyBytes,
            updatedAt: new Date(),
          })
          .where(eq(annotations.id, params.id))
          .returning({
            id: annotations.id,
            context: annotations.context,
            style: annotations.style,
            body: annotations.body,
            bodyBytes: annotations.bodyBytes,
            sequence: annotations.sequence,
          });

        if (!row) throw new Error('updateAnnotation: update returned no row');
        return row;
      },
    };

    return await work(repo);
  });
}
