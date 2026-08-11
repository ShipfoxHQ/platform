import type {WorkflowsJobExecutionQueuedEventDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {enqueueJobExecution} from '#db/job-executions.js';

export async function onWorkflowsJobExecutionQueued(
  payload: WorkflowsJobExecutionQueuedEventDto,
): Promise<void> {
  logger().info(
    {
      jobId: payload.jobId,
      jobExecutionId: payload.jobExecutionId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
    },
    'Queueing runner job execution from workflow fact',
  );
  await enqueueJobExecution({
    workspaceId: payload.workspaceId,
    workflowRunId: payload.workflowRunId,
    workflowRunAttemptId: payload.workflowRunAttemptId,
    jobId: payload.jobId,
    jobExecutionId: payload.jobExecutionId,
    projectId: payload.projectId,
    requiredLabels: payload.requiredLabels,
    queuedAt: new Date(payload.queuedAt),
  });
}
