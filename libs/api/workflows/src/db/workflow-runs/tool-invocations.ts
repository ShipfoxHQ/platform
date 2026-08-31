import {asc, eq} from 'drizzle-orm';
import {db, type Tx} from '../db.js';
import {type ToolInvocationDb, toolInvocations} from '../schema/tool-invocations.js';

export interface EnqueueToolInvocationParams {
  stepId: string;
  stepAttemptId: string;
  jobExecutionId: string;
  workspaceId: string;
  dueAt: Date;
  callIndex?: number | undefined;
}

// The unique step-attempt anchor makes this safe if a caller retries the same
// dispatch inside a transaction that has already opened the attempt.
export async function enqueueToolInvocation(
  params: EnqueueToolInvocationParams,
  tx: Tx,
): Promise<void> {
  await tx
    .insert(toolInvocations)
    .values({
      stepId: params.stepId,
      stepAttemptId: params.stepAttemptId,
      jobExecutionId: params.jobExecutionId,
      workspaceId: params.workspaceId,
      status: 'queued',
      callIndex: params.callIndex ?? 0,
      dueAt: params.dueAt,
    })
    .onConflictDoNothing({target: [toolInvocations.stepAttemptId]});
}

export function getToolInvocationsByJobExecutionId(
  jobExecutionId: string,
): Promise<ToolInvocationDb[]> {
  return db()
    .select()
    .from(toolInvocations)
    .where(eq(toolInvocations.jobExecutionId, jobExecutionId))
    .orderBy(asc(toolInvocations.callIndex), asc(toolInvocations.id));
}
