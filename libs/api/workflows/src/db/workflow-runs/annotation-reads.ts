import {and, eq, or, type SQL} from 'drizzle-orm';
import {db} from '../db.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobs} from '../schema/jobs.js';
import {stepAttempts} from '../schema/step-attempts.js';
import {steps} from '../schema/steps.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {workflowRuns} from '../schema/workflow-runs.js';
import type {WorkflowRunOverviewReadOptions} from './overview.js';

/** The workflow-owned identity needed to enrich one annotation page. */
export interface WorkflowRunAnnotationOriginReference {
  jobId: string;
  jobExecutionId: string;
  stepId: string;
  stepAttempt: number;
}

export interface WorkflowRunAnnotationOriginRead extends WorkflowRunAnnotationOriginReference {
  jobLabel: string;
  jobPosition: number;
  executionSequence: number;
  executionLabel: string | null;
  stepLabel: string;
  stepAttemptId: string | null;
}

/** Builds the stable identity used to match annotation-owner rows to workflow ancestry. */
export function workflowRunAnnotationOriginKey(
  origin: WorkflowRunAnnotationOriginReference,
): string {
  return [origin.jobId, origin.jobExecutionId, origin.stepId, origin.stepAttempt].join(':');
}

/**
 * Resolves only the workflow-owned ancestry named by an annotation page. The annotation body is
 * deliberately absent here: its owner returns that data through the inter-module contract.
 */
export async function getWorkflowRunAnnotationOrigins(
  params: {
    workspaceId: string;
    projectId: string;
    workflowRunId: string;
    attempt: number;
    origins: readonly WorkflowRunAnnotationOriginReference[];
  },
  options: WorkflowRunOverviewReadOptions = {},
): Promise<WorkflowRunAnnotationOriginRead[]> {
  const startedAt = performance.now();
  let returnedRows = 0;

  try {
    const origins = uniqueOrigins(params.origins);
    if (origins.length === 0) return [];

    const result = await db().transaction(
      async (tx) => {
        const originCondition = or(...origins.map(workflowOriginCondition));
        if (!originCondition) return [];

        const workflowRows = await tx
          .select({
            jobId: jobs.id,
            jobExecutionId: jobExecutions.id,
            stepId: steps.id,
            jobKey: jobs.key,
            jobName: jobs.name,
            jobPosition: jobs.position,
            executionSequence: jobExecutions.sequence,
            executionName: jobExecutions.name,
            stepName: steps.name,
          })
          .from(jobs)
          .innerJoin(jobExecutions, eq(jobExecutions.jobId, jobs.id))
          .innerJoin(steps, eq(steps.jobExecutionId, jobExecutions.id))
          .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
          .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
          .where(
            and(
              eq(workflowRuns.id, params.workflowRunId),
              eq(workflowRuns.workspaceId, params.workspaceId),
              eq(workflowRuns.projectId, params.projectId),
              eq(workflowRunAttempts.attempt, params.attempt),
              originCondition,
            ),
          );
        returnedRows += workflowRows.length;

        const validOrigins = origins.filter((origin) =>
          workflowRows.some(
            (row) =>
              row.jobId === origin.jobId &&
              row.jobExecutionId === origin.jobExecutionId &&
              row.stepId === origin.stepId,
          ),
        );
        const attemptCondition = or(...validOrigins.map(stepAttemptCondition));
        const attemptRows = attemptCondition
          ? await tx
              .select({
                id: stepAttempts.id,
                stepId: stepAttempts.stepId,
                jobExecutionId: stepAttempts.jobExecutionId,
                attempt: stepAttempts.attempt,
              })
              .from(stepAttempts)
              .where(attemptCondition)
          : [];
        returnedRows += attemptRows.length;

        const workflowRowByOrigin = new Map(
          workflowRows.map((row) => [workflowOriginKey(row), row]),
        );
        const attemptIdByOrigin = new Map(attemptRows.map((row) => [stepAttemptKey(row), row.id]));

        return validOrigins.flatMap((origin) => {
          const row = workflowRowByOrigin.get(workflowOriginKey(origin));
          if (!row) return [];

          return [
            {
              jobId: origin.jobId,
              jobExecutionId: origin.jobExecutionId,
              stepId: origin.stepId,
              stepAttempt: origin.stepAttempt,
              jobLabel: row.jobName ?? row.jobKey,
              jobPosition: row.jobPosition,
              executionSequence: row.executionSequence,
              executionLabel: row.executionName,
              stepLabel: row.stepName,
              stepAttemptId: attemptIdByOrigin.get(stepAttemptKey(origin)) ?? null,
            },
          ];
        });
      },
      {isolationLevel: 'repeatable read', accessMode: 'read only'},
    );

    return result;
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

function uniqueOrigins(
  origins: readonly WorkflowRunAnnotationOriginReference[],
): WorkflowRunAnnotationOriginReference[] {
  const unique = new Map<string, WorkflowRunAnnotationOriginReference>();
  for (const origin of origins) unique.set(workflowRunAnnotationOriginKey(origin), origin);
  return [...unique.values()];
}

function workflowOriginCondition(origin: WorkflowRunAnnotationOriginReference): SQL {
  return requireCondition(
    and(
      eq(jobs.id, origin.jobId),
      eq(jobExecutions.id, origin.jobExecutionId),
      eq(steps.id, origin.stepId),
    ),
  );
}

function stepAttemptCondition(origin: WorkflowRunAnnotationOriginReference): SQL {
  return requireCondition(
    and(
      eq(stepAttempts.stepId, origin.stepId),
      eq(stepAttempts.jobExecutionId, origin.jobExecutionId),
      eq(stepAttempts.attempt, origin.stepAttempt),
    ),
  );
}

function requireCondition(condition: SQL | undefined): SQL {
  if (!condition) throw new Error('Expected a non-empty SQL condition');
  return condition;
}

function workflowOriginKey(origin: {
  jobId: string;
  jobExecutionId: string;
  stepId: string;
}): string {
  return [origin.jobId, origin.jobExecutionId, origin.stepId, ''].join(':');
}

function stepAttemptKey(origin: {
  jobExecutionId: string;
  stepId: string;
  stepAttempt?: number | null;
  attempt?: number | null;
}): string {
  return [origin.jobExecutionId, origin.stepId, origin.stepAttempt ?? origin.attempt ?? ''].join(
    ':',
  );
}
