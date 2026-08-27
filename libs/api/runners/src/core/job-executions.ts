import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import type {RunnerLifecycleCapabilitiesDto} from '@shipfox/api-runners-dto';
import {claimPendingJobExecution} from '#db/job-executions.js';
import {jobExecutionClaimedCount} from '#metrics/instance.js';
import {config} from '../config.js';

export interface ClaimJobExecutionResult {
  workflowRunId: string;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  leaseToken: string;
  isolationTimeoutSeconds?: number;
}

export async function claimJobExecution(params: {
  auth: AuthInterModuleClient;
  workspaceId: string;
  runnerSessionId: string;
  sessionLabels: string[];
  maxClaims: number | null;
  lifecycleCapabilities?: RunnerLifecycleCapabilitiesDto | null;
}): Promise<ClaimJobExecutionResult | null> {
  const claimed = await claimPendingJobExecution({
    ...params,
    runnerSessionLivenessThrottleSeconds: config.RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS,
  });
  if (!claimed) {
    jobExecutionClaimedCount.add(1, {outcome: 'empty'});
    return null;
  }
  jobExecutionClaimedCount.add(1, {outcome: 'claimed'});

  const {token: leaseToken} = await params.auth.mintJobLeaseToken({
    workflowRunId: claimed.workflowRunId,
    workflowRunAttemptId: claimed.workflowRunAttemptId,
    jobId: claimed.jobId,
    jobExecutionId: claimed.jobExecutionId,
    projectId: claimed.projectId,
    workspaceId: params.workspaceId,
    runnerSessionId: params.runnerSessionId,
  });

  return {
    workflowRunId: claimed.workflowRunId,
    workflowRunAttemptId: claimed.workflowRunAttemptId,
    jobId: claimed.jobId,
    jobExecutionId: claimed.jobExecutionId,
    leaseToken,
    ...(params.lifecycleCapabilities?.includes('local_execution_fence_v1')
      ? {isolationTimeoutSeconds: config.RUNNER_LOCAL_ISOLATION_TIMEOUT_SECONDS}
      : {}),
  };
}
