import type {WorkflowsJobExecutionTerminatedEventDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {reconcileTerminalJobExecution} from '#db/job-executions.js';

export async function onWorkflowsJobExecutionTerminated(
  payload: WorkflowsJobExecutionTerminatedEventDto,
): Promise<void> {
  logger().info(
    {
      jobId: payload.jobId,
      jobExecutionId: payload.jobExecutionId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      status: payload.status,
    },
    'Reconciling runner state for terminal job execution',
  );
  const cancellationReason =
    payload.cancellationReason ??
    (payload.statusReason === 'run_cancelled' || payload.statusReason === 'timed_out'
      ? payload.statusReason
      : null);
  await reconcileTerminalJobExecution({
    jobExecutionId: payload.jobExecutionId,
    cancellationReason,
    ...(payload.finishedAt ? {finishedAt: new Date(payload.finishedAt)} : {}),
  });
}
