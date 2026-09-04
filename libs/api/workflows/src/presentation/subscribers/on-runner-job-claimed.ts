import type {RunnerJobClaimedEvent} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {recordJobExecutionStartedAt} from '#db/index.js';
import {JOB_CLAIMED_SIGNAL} from '#temporal/constants.js';
import {isWorkflowNotFound} from '#temporal/workflow-not-found.js';

// Anticorruption layer: the runner reports a `claimed` fact in its own lease-broker
// language; the run lifecycle treats the claim as the job's start, so we project it onto
// `started_at`. Use the runner-owned claim timestamp, not subscriber time; the DB
// projection is first-write-wins so outbox replay cannot move the run boundary.
export async function onRunnerJobClaimed(payload: RunnerJobClaimedEvent): Promise<void> {
  logger().debug(
    {
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      jobId: payload.jobId,
      jobExecutionId: payload.jobExecutionId,
    },
    'Recording job execution started_at from claim',
  );
  await recordJobExecutionStartedAt({
    jobExecutionId: payload.jobExecutionId,
    startedAt: new Date(payload.claimedAt),
    runnerIdentity: {
      runnerLabels: payload.runnerLabels ?? null,
      templateKey: payload.templateKey ?? null,
      provisionerId: payload.provisionerId ?? null,
      provisionerScope: payload.provisionerScope ?? null,
      providerKind: payload.providerKind ?? null,
      launchKind: payload.launchKind ?? null,
    },
  });

  const handle = temporalClient().workflow.getHandle(`job:${payload.jobId}`);
  try {
    await handle.signal(JOB_CLAIMED_SIGNAL, {
      jobExecutionId: payload.jobExecutionId,
      claimedAt: payload.claimedAt,
    });
  } catch (err) {
    // A terminal execution can race the claim outbox delivery. Its persisted status is
    // authoritative, so discard the signal if Temporal has already closed the workflow.
    if (isWorkflowNotFound(err)) {
      logger().debug(
        {jobId: payload.jobId, jobExecutionId: payload.jobExecutionId},
        'Job workflow already terminated; claim event discarded',
      );
      return;
    }
    throw err;
  }
}
