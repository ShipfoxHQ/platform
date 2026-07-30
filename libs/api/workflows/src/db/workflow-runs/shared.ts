import {eq, sql} from 'drizzle-orm';
import type {JobStatus} from '#core/entities/job.js';
import type {JobExecutionStatus} from '#core/entities/job-execution.js';
import type {WorkflowRunStatus} from '#core/entities/workflow-run.js';
import type {Tx} from '../db.js';
import {jobs} from '../schema/jobs.js';
import {steps} from '../schema/steps.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {workflowRuns} from '../schema/workflow-runs.js';

export const TERMINAL_WORKFLOW_RUN_STATUSES: WorkflowRunStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
];

export const TERMINAL_JOB_STATUSES: JobStatus[] = ['succeeded', 'failed', 'cancelled', 'skipped'];

export const TERMINAL_EXECUTION_STATUSES: JobExecutionStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
];

export const NON_TERMINAL_STEP_STATUS_FILTER = sql`${steps.status} NOT IN ('succeeded','failed','cancelled','skipped')`;

export async function lockWorkflowRun(
  id: string,
  tx: Tx,
): Promise<typeof workflowRuns.$inferSelect | undefined> {
  const rows = await tx
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, id))
    .limit(1)
    .for('update');
  return rows[0];
}

export async function optimisticLockRetry<TResult, TFetched>(params: {
  updateFn: () => Promise<TResult | null>;
  fetchFn: () => Promise<TFetched | undefined>;
  matchFn: (value: TFetched) => TResult | null;
  failureMessage: string;
}): Promise<TResult> {
  const updated = await params.updateFn();
  if (updated) return updated;

  const existing = await params.fetchFn();
  if (existing) {
    const matched = params.matchFn(existing);
    if (matched) return matched;
  }

  throw new Error(params.failureMessage);
}

export async function getWorkflowContextForJob(
  jobId: string,
  tx: Tx,
): Promise<{
  jobId: string;
  workflowRunId: string;
  workflowRunAttemptId: string;
  workspaceId: string;
  projectId: string;
  vars: Record<string, string> | null;
}> {
  const rows = await tx
    .select({
      jobId: jobs.id,
      workflowRunId: workflowRuns.id,
      workflowRunAttemptId: workflowRunAttempts.id,
      workspaceId: workflowRuns.workspaceId,
      projectId: workflowRuns.projectId,
      vars: workflowRunAttempts.vars,
    })
    .from(jobs)
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  const context = rows[0];
  if (!context) throw new Error(`Cannot load workflow context: job ${jobId} not found`);
  return context;
}
