import {AUTH_LEASED_JOB, setLeasedJobContext} from '@shipfox/api-auth-context';
import {JOB_LEASE_TOKEN_AUDIENCE, type JobLeaseTokenClaims} from '@shipfox/api-auth-dto';
import {type AuthMethod, ClientError, extractBearerToken} from '@shipfox/node-fastify';

const leaseClaims = new Map<string, JobLeaseTokenClaims>();

export interface MintLeaseTokenParams {
  jobId: string;
  jobExecutionId: string;
  workspaceId?: string;
  projectId?: string;
  workflowRunId?: string;
  workflowRunAttemptId?: string;
  currentStepId?: string;
  currentStepAttempt?: number;
}

export function mintLeaseToken(params: MintLeaseTokenParams): Promise<string> {
  const token = `test-auth-${crypto.randomUUID()}`;
  leaseClaims.set(token, {
    jobId: params.jobId,
    jobExecutionId: params.jobExecutionId,
    workflowRunId: params.workflowRunId ?? crypto.randomUUID(),
    workflowRunAttemptId: params.workflowRunAttemptId ?? crypto.randomUUID(),
    projectId: params.projectId ?? crypto.randomUUID(),
    workspaceId: params.workspaceId ?? crypto.randomUUID(),
    runnerSessionId: crypto.randomUUID(),
    ...(params.currentStepId && params.currentStepAttempt !== undefined
      ? {currentStepId: params.currentStepId, currentStepAttempt: params.currentStepAttempt}
      : {}),
    aud: JOB_LEASE_TOKEN_AUDIENCE,
    iat: 0,
    exp: Number.MAX_SAFE_INTEGER,
  });
  return Promise.resolve(token);
}

export const fakeLeaseTokenAuthMethod: AuthMethod = {
  name: AUTH_LEASED_JOB,
  authenticate: (request) => {
    const token = extractBearerToken(request.headers.authorization);
    const claims = token ? leaseClaims.get(token) : undefined;
    if (!claims) throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    setLeasedJobContext(request, claims);
    return Promise.resolve();
  },
};
