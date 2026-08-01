import type {WorkflowsJobStepsSettledEventDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {JOB_FINISHED_SIGNAL} from '#temporal/constants.js';
import {isWorkflowNotFound} from '#temporal/workflow-not-found.js';

// Per-step execution finishes a job inside recordStepResult (no runner /complete
// call), which enqueues WORKFLOWS_JOB_STEPS_SETTLED in the same transaction. The
// persisted per-step projection is already terminal, so the workflow only flips
// the job status: no steps are carried.
export async function onJobStepsSettled(payload: WorkflowsJobStepsSettledEventDto): Promise<void> {
  logger().info(
    {
      jobId: payload.jobId,
      jobExecutionId: payload.jobExecutionId,
      status: payload.status,
    },
    'Signaling job finished',
  );
  const handle = temporalClient().workflow.getHandle(`job:${payload.jobId}`);
  try {
    await handle.signal(JOB_FINISHED_SIGNAL, {
      status: payload.status,
      jobExecutionId: payload.jobExecutionId,
    });
  } catch (err) {
    // Workflow already terminated (e.g. timeout path); its status is
    // authoritative, drop this late event.
    if (isWorkflowNotFound(err)) {
      logger().debug(
        {
          jobId: payload.jobId,
          jobExecutionId: payload.jobExecutionId,
          status: payload.status,
        },
        'Job workflow already terminated; job-finished event discarded',
      );
      return;
    }
    throw err;
  }
}
