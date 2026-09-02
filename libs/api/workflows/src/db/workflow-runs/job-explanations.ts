import {and, asc, eq, gt, inArray, notExists, or} from 'drizzle-orm';
import {type JobStatus, type JobStatusReason, toJobStatusReason} from '#core/entities/job.js';
import type {PersistedEvaluationTraceEntry} from '#core/entities/step.js';
import {db} from '../db.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobs} from '../schema/jobs.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {workflowRuns} from '../schema/workflow-runs.js';
import type {WorkflowRunJobCursor, WorkflowRunOverviewReadOptions} from './overview.js';

export interface WorkflowRunJobExplanationRead {
  jobId: string;
  jobLabel: string;
  jobPosition: number;
  status: Extract<JobStatus, 'failed' | 'skipped'>;
  statusReason: JobStatusReason | null;
  evaluationTrace: readonly PersistedEvaluationTraceEntry[] | null;
}

export interface WorkflowRunJobExplanationsPageRead {
  items: WorkflowRunJobExplanationRead[];
  nextCursor: WorkflowRunJobCursor | null;
}

/** Lists bounded explanations for failed or skipped jobs that never created an execution. */
export async function listWorkflowRunJobExplanationsPage(
  params: {
    workspaceId: string;
    projectId: string;
    workflowRunId: string;
    attempt: number;
    limit: number;
    cursor?: WorkflowRunJobCursor | undefined;
  },
  options: WorkflowRunOverviewReadOptions = {},
): Promise<WorkflowRunJobExplanationsPageRead | undefined> {
  const startedAt = performance.now();
  let returnedRows = 0;

  try {
    return await db().transaction(
      async (tx) => {
        const [target] = await tx
          .select({attemptId: workflowRunAttempts.id})
          .from(workflowRunAttempts)
          .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
          .where(
            and(
              eq(workflowRuns.id, params.workflowRunId),
              eq(workflowRuns.workspaceId, params.workspaceId),
              eq(workflowRuns.projectId, params.projectId),
              eq(workflowRunAttempts.attempt, params.attempt),
            ),
          )
          .limit(1);
        if (!target) return undefined;
        returnedRows += 1;

        const conditions = [
          eq(jobs.workflowRunAttemptId, target.attemptId),
          inArray(jobs.status, ['failed', 'skipped'] as const),
          notExists(
            tx
              .select({id: jobExecutions.id})
              .from(jobExecutions)
              .where(eq(jobExecutions.jobId, jobs.id)),
          ),
        ];
        if (params.cursor) {
          const cursorCondition = or(
            gt(jobs.position, params.cursor.position),
            and(eq(jobs.position, params.cursor.position), gt(jobs.id, params.cursor.id)),
          );
          if (cursorCondition) conditions.push(cursorCondition);
        }

        const rows = await tx
          .select({
            id: jobs.id,
            key: jobs.key,
            name: jobs.name,
            position: jobs.position,
            status: jobs.status,
            statusReason: jobs.statusReason,
            evaluationTrace: jobs.evaluationTrace,
          })
          .from(jobs)
          .where(and(...conditions))
          .orderBy(asc(jobs.position), asc(jobs.id))
          .limit(params.limit + 1);
        returnedRows += rows.length;

        const hasMore = rows.length > params.limit;
        const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
        const last = pageRows.at(-1);
        return {
          items: pageRows.map((row) => ({
            jobId: row.id,
            jobLabel: row.name ?? row.key,
            jobPosition: row.position,
            status: row.status as Extract<JobStatus, 'failed' | 'skipped'>,
            statusReason: toJobStatusReason(row.statusReason),
            evaluationTrace: row.evaluationTrace ?? null,
          })),
          nextCursor: hasMore && last ? {position: last.position, id: last.id} : null,
        };
      },
      {isolationLevel: 'repeatable read', accessMode: 'read only'},
    );
  } finally {
    try {
      options.onRead?.({
        databaseDurationMilliseconds: performance.now() - startedAt,
        returnedRows,
      });
    } catch {
      // Measurement observers must not change the bounded read outcome.
    }
  }
}
