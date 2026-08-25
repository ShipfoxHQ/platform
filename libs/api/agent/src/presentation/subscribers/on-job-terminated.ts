import type {WorkflowsJobTerminatedEventDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {resolveCloseGraceSeconds} from '#config.js';
import {AGENT_SESSION_LIFECYCLE_TASK_QUEUE} from '#temporal/constants.js';

/**
 * The release activity's `startToCloseTimeout` in `release-abandoned-session-claims.ts`,
 * plus a margin: the workflow execution timeout must cover the grace sleep and
 * the activity, or a grace window at or above the fixed timeout would time the
 * workflow out before it ever releases the job's claims.
 */
const RELEASE_ACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const RELEASE_TIMEOUT_MARGIN_MS = 60 * 1000;

/**
 * A job reached a terminal state (any path: completion, cancellation, lease-expiry,
 * timeout). Arm the grace-then-release workflow for any of its session claims the
 * step-attempt-terminated subscriber never cleared (a runner that died before
 * reporting, a lost event). Deduped by workflow id, so a redelivered event is a no-op.
 * The grace window is resolved to a bounded positive integer (see
 * `resolveCloseGraceSeconds`) so a misconfigured AGENT_SESSION_CLOSE_GRACE_SECONDS
 * can never fire the sweep immediately, feed a non-finite `sleep`, or overflow
 * the derived execution timeout; the execution timeout is derived from that
 * grace so a long configured grace can never time the workflow out mid-sleep.
 */
export async function onJobTerminated(payload: WorkflowsJobTerminatedEventDto): Promise<void> {
  try {
    const graceSeconds = resolveCloseGraceSeconds();
    await temporalClient().workflow.start('releaseAbandonedSessionClaims', {
      taskQueue: AGENT_SESSION_LIFECYCLE_TASK_QUEUE,
      workflowId: `agent-session-release:${payload.jobId}`,
      // Derived from the resolved grace plus the activity timeout (and a small
      // margin) so the workflow always outlives its own grace sleep; the fixed
      // timeout also keeps a stranded workflow from hanging forever after a
      // rollback stops the worker polling this queue.
      workflowExecutionTimeout:
        graceSeconds * 1000 + RELEASE_ACTIVITY_TIMEOUT_MS + RELEASE_TIMEOUT_MARGIN_MS,
      args: [
        {
          jobId: payload.jobId,
          graceSeconds,
        },
      ],
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError') {
      logger().debug(
        {jobId: payload.jobId},
        'Release-abandoned-session-claims workflow already started',
      );
      return;
    }
    throw error;
  }
}
