import {and, asc, eq} from 'drizzle-orm';
import {db} from '../db.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobs} from '../schema/jobs.js';
import {stepAttempts} from '../schema/step-attempts.js';
import {steps} from '../schema/steps.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {workflowRuns} from '../schema/workflow-runs.js';

export interface WorkflowFailedStepAttemptRead {
  workflowRunId: string;
  workflowRunAttempt: number;
  jobId: string;
  jobExecutionId: string;
  stepId: string;
  stepAttemptId: string;
  stepAttempt: number;
}

/**
 * Selects a bounded, deterministic set of failed step-attempt coordinates for
 * run-level diagnostics. Only coordinates are materialized; diagnostic bodies
 * remain behind the step-attempt detail read.
 */
export async function listFailedStepAttempts(params: {
  workspaceId: string;
  projectId: string;
  workflowRunId: string;
  attempt: number;
  limit: number;
}): Promise<WorkflowFailedStepAttemptRead[] | undefined> {
  return await db().transaction(
    async (tx) => {
      const [target] = await tx
        .select({
          id: workflowRunAttempts.id,
          attempt: workflowRunAttempts.attempt,
        })
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

      const rows = await tx
        .select({
          workflowRunId: workflowRuns.id,
          workflowRunAttempt: workflowRunAttempts.attempt,
          jobId: jobs.id,
          jobExecutionId: jobExecutions.id,
          stepId: steps.id,
          stepAttemptId: stepAttempts.id,
          stepAttempt: stepAttempts.attempt,
        })
        .from(stepAttempts)
        .innerJoin(
          steps,
          and(
            eq(stepAttempts.stepId, steps.id),
            eq(stepAttempts.jobExecutionId, steps.jobExecutionId),
          ),
        )
        .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
        .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
        .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
        .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
        .where(and(eq(workflowRunAttempts.id, target.id), eq(stepAttempts.status, 'failed')))
        .orderBy(
          asc(jobs.position),
          asc(jobExecutions.sequence),
          asc(steps.position),
          asc(stepAttempts.attempt),
          asc(stepAttempts.id),
        )
        .limit(params.limit);

      return rows;
    },
    {isolationLevel: 'repeatable read', accessMode: 'read only'},
  );
}
