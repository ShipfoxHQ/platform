import type {WorkflowRunAttempt} from '#core/entities/workflow-run-attempt.js';
import {listRunAttemptsPage} from '#db/workflow-runs.js';

/** Test-only compatibility helper for assertions that need the complete attempt history. */
export async function listTestRunAttempts(params: {
  workflowRunId: string;
  projectId: string;
}): Promise<WorkflowRunAttempt[]> {
  const attempts: WorkflowRunAttempt[] = [];
  let cursor: {value: number; id: string} | undefined;

  for (;;) {
    const page = await listRunAttemptsPage({
      ...params,
      limit: 100,
      ...(cursor ? {cursor} : {}),
    });
    attempts.push(...page.attempts);
    if (!page.nextCursor) {
      return attempts.sort((left, right) => left.attempt - right.attempt);
    }
    cursor = page.nextCursor;
  }
}
