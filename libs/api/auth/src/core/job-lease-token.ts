import {
  JOB_LEASE_TOKEN_AUDIENCE,
  type JobLeaseTokenClaims,
  jobLeaseTokenClaimsSchema,
} from '@shipfox/api-auth-dto';
import {jobLeaseTokenKey} from '@shipfox/node-auth-root-key';
import {signHs256, verifyHs256} from '@shipfox/node-jwt';
import {config} from '#config.js';
import {recordTokenIssued, recordTokenVerified} from '#metrics/index.js';

// `aud`, `iat` and `exp` are set by the codec (jose); callers supply the business ids only.
export type IssueJobLeaseTokenParams = Omit<JobLeaseTokenClaims, 'aud' | 'iat' | 'exp'>;

type JobLeaseParamSource = Pick<
  JobLeaseTokenClaims,
  | 'workflowRunId'
  | 'workflowRunAttemptId'
  | 'jobId'
  | 'jobExecutionId'
  | 'projectId'
  | 'workspaceId'
  | 'runnerSessionId'
>;

export function jobLeaseParamsFrom(
  source: JobLeaseParamSource,
  stepScope?: {currentStepId: string; currentStepAttempt: number},
): IssueJobLeaseTokenParams {
  return {
    workflowRunId: source.workflowRunId,
    workflowRunAttemptId: source.workflowRunAttemptId,
    jobId: source.jobId,
    jobExecutionId: source.jobExecutionId,
    projectId: source.projectId,
    workspaceId: source.workspaceId,
    runnerSessionId: source.runnerSessionId,
    ...(stepScope ? stepScope : {}),
  };
}

export async function issueJobLeaseToken(claims: IssueJobLeaseTokenParams): Promise<string> {
  const token = await signHs256({
    payload: {
      workflowRunId: claims.workflowRunId,
      ...(claims.workflowRunAttempt === undefined
        ? {}
        : {workflowRunAttempt: claims.workflowRunAttempt}),
      workflowRunAttemptId: claims.workflowRunAttemptId,
      jobId: claims.jobId,
      jobExecutionId: claims.jobExecutionId,
      projectId: claims.projectId,
      workspaceId: claims.workspaceId,
      runnerSessionId: claims.runnerSessionId,
      ...(claims.currentStepId && claims.currentStepAttempt !== undefined
        ? {
            currentStepId: claims.currentStepId,
            currentStepAttempt: claims.currentStepAttempt,
          }
        : {}),
    },
    secret: jobLeaseTokenKey(),
    expiresIn: config.AUTH_JOB_LEASE_TOKEN_EXPIRES_IN,
    audience: JOB_LEASE_TOKEN_AUDIENCE,
  });
  recordTokenIssued('job_lease');
  return token;
}

/** Returns the claims on success, or `null` for any invalid input. Never throws. */
export async function verifyJobLeaseToken(token: string): Promise<JobLeaseTokenClaims | null> {
  try {
    const claims = await verifyHs256({
      token,
      secret: jobLeaseTokenKey(),
      schema: jobLeaseTokenClaimsSchema,
      audience: JOB_LEASE_TOKEN_AUDIENCE,
    });
    recordTokenVerified('job_lease', 'ok');
    return claims;
  } catch {
    recordTokenVerified('job_lease', 'rejected');
    return null;
  }
}
