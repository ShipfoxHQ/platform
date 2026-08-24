import type {WorkflowsJobTerminatedEventDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {config} from '#config.js';
import {AGENT_SESSION_LIFECYCLE_TASK_QUEUE} from '#temporal/constants.js';

/**
 * A job reached a terminal state (any path: completion, cancellation, lease-expiry,
 * timeout). Arm the grace-then-release workflow for any of its session claims the
 * step-attempt-terminated subscriber never cleared (a runner that died before
 * reporting, a lost event). Deduped by workflow id, so a redelivered event is a no-op.
 * The grace window is clamped to a positive value so a misconfigured
 * AGENT_SESSION_CLOSE_GRACE_SECONDS can never fire the sweep immediately and race
 * the last in-flight attempt report.
 */
export async function onJobTerminated(payload: WorkflowsJobTerminatedEventDto): Promise<void> {
  try {
    await temporalClient().workflow.start('releaseAbandonedSessionClaims', {
      taskQueue: AGENT_SESSION_LIFECYCLE_TASK_QUEUE,
      workflowId: `agent-session-release:${payload.jobId}`,
      // A fixed execution timeout keeps a stranded workflow from hanging forever
      // after a rollback stops the worker polling this queue.
      workflowExecutionTimeout: '1 hour',
      args: [
        {
          jobId: payload.jobId,
          graceSeconds: Math.max(1, config.AGENT_SESSION_CLOSE_GRACE_SECONDS),
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
