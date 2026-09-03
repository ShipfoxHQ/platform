import {
  getFirstJobExecutionByJobId,
  getJobById,
  getWorkflowRunByAttemptId,
} from '#db/workflow-runs.js';
import {mintLeaseToken} from './lease-token.js';
import {registerActiveRunnerLease} from './runners-inter-module.js';

export interface MintActiveLeaseTokenParams {
  jobId: string;
  token?: {
    workflowRunId?: string;
    workflowRunAttemptId?: string;
    projectId?: string;
    workspaceId?: string;
  };
  renewableInference?: boolean | undefined;
}

export async function mintActiveLeaseToken(params: MintActiveLeaseTokenParams): Promise<string> {
  const jobExecution = await getFirstJobExecutionByJobId(params.jobId);
  if (!jobExecution) throw new Error('Expected job execution to exist');
  const job = await getJobById(params.jobId);
  if (!job) throw new Error('Expected job to exist');
  const run = await getWorkflowRunByAttemptId(job.workflowRunAttemptId);
  if (!run) throw new Error('Expected workflow run to exist');
  const runnerSessionId = crypto.randomUUID();

  registerActiveRunnerLease({
    jobId: params.jobId,
    jobExecutionId: jobExecution.id,
    runnerSessionId,
    renewableInference: params.renewableInference,
  });

  return await mintLeaseToken({
    jobId: params.jobId,
    jobExecutionId: jobExecution.id,
    workflowRunId: params.token?.workflowRunId ?? run.id,
    workflowRunAttemptId: params.token?.workflowRunAttemptId ?? job.workflowRunAttemptId,
    projectId: params.token?.projectId ?? run.projectId,
    workspaceId: params.token?.workspaceId ?? run.workspaceId,
    runnerSessionId,
  });
}

export interface InsertRunningJobLeaseParams {
  workspaceId: string;
  workflowRunId: string;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  projectId: string;
  runnerSessionId: string;
  renewableInference?: boolean | undefined;
}

export function insertRunningJobLease(params: InsertRunningJobLeaseParams): Promise<void> {
  registerActiveRunnerLease(params);
  return Promise.resolve();
}
