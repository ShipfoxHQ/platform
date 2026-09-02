import {and, eq} from 'drizzle-orm';
import type {WorkflowRunOrigin, WorkflowSourceSnapshot} from '#core/entities/workflow-run.js';
import {db} from '../db.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {workflowRuns} from '../schema/workflow-runs.js';

export interface WorkflowRunSourceRead {
  workflowRunId: string;
  workflowRunAttempt: number;
  origin: WorkflowRunOrigin;
  sourceSnapshot: WorkflowSourceSnapshot | null;
}

/** Loads only the immutable source projection for the run's current attempt. */
export async function getWorkflowRunSource(
  workflowRunId: string,
): Promise<WorkflowRunSourceRead | undefined> {
  const [row] = await db()
    .select({
      workflowRunId: workflowRuns.id,
      workflowRunAttempt: workflowRunAttempts.attempt,
      origin: workflowRuns.origin,
      sourceSnapshot: workflowRuns.sourceSnapshot,
    })
    .from(workflowRuns)
    .innerJoin(
      workflowRunAttempts,
      and(
        eq(workflowRunAttempts.workflowRunId, workflowRuns.id),
        eq(workflowRunAttempts.attempt, workflowRuns.currentAttempt),
      ),
    )
    .where(eq(workflowRuns.id, workflowRunId))
    .limit(1);

  if (!row) return undefined;
  return {
    workflowRunId: row.workflowRunId,
    workflowRunAttempt: row.workflowRunAttempt,
    origin: row.origin as WorkflowRunOrigin,
    sourceSnapshot: row.sourceSnapshot ?? null,
  };
}
