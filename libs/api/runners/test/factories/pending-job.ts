import {Factory} from 'fishery';
import {enqueueJobExecution} from '#db/job-executions.js';

interface PendingJobAttrs {
  workspaceId: string;
  workflowRunId: string;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  projectId: string;
  requiredLabels: string[];
  queuedAt: Date;
}

export const pendingJobFactory = Factory.define<PendingJobAttrs>(({onCreate}) => {
  const jobId = crypto.randomUUID();
  const jobExecutionId = crypto.randomUUID();
  const workflowRunId = crypto.randomUUID();
  const workflowRunAttemptId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();

  onCreate(async (attrs) => {
    await enqueueJobExecution({
      workspaceId: attrs.workspaceId,
      workflowRunId: attrs.workflowRunId,
      workflowRunAttemptId: attrs.workflowRunAttemptId,
      jobId: attrs.jobId,
      jobExecutionId: attrs.jobExecutionId,
      projectId: attrs.projectId,
      requiredLabels: attrs.requiredLabels,
      queuedAt: attrs.queuedAt,
    });
    return attrs;
  });

  return {
    workspaceId,
    workflowRunId,
    workflowRunAttemptId,
    jobId,
    jobExecutionId,
    projectId,
    requiredLabels: ['linux'],
    queuedAt: new Date(),
  };
});
