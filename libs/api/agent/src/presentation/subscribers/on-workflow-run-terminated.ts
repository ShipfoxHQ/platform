import type {WorkflowsWorkflowRunTerminatedEventDto} from '@shipfox/api-workflows-dto';
import {db} from '#db/db.js';
import {retireSessionsForRunAttempt} from '#db/retention.js';

/**
 * A workflow run attempt reached a terminal state (any path: success, failure,
 * cancellation). Stamp its sessions with `retired_at` so the retention sweep
 * can delete them once the retention window has elapsed. Idempotent: a
 * redelivered event keeps the original stamp, so the retention horizon never
 * resets on an outbox replay.
 */
export async function onWorkflowRunTerminated(
  payload: WorkflowsWorkflowRunTerminatedEventDto,
): Promise<void> {
  await db().transaction((tx) => retireSessionsForRunAttempt(tx, payload.workflowRunAttemptId));
}
