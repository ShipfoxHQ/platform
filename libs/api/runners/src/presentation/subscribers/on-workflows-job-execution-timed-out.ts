import type {WorkflowsJobExecutionTimedOutEventDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {reconcileTerminalJobExecution} from '#db/job-executions.js';

export async function onWorkflowsJobExecutionTimedOut(
  payload: WorkflowsJobExecutionTimedOutEventDto,
): Promise<void> {
  logger().info(
    {
      jobId: payload.jobId,
      jobExecutionId: payload.jobExecutionId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
    },
    'Reconciling runner state for timed-out job execution',
  );
  await reconcileTerminalJobExecution({jobExecutionId: payload.jobExecutionId});
}
