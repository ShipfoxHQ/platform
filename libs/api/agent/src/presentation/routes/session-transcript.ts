import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import {
  type WorkflowsModuleClient,
  workflowsInterModuleContract,
} from '@shipfox/api-workflows-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import {config} from '#config.js';
import type {AgentSession} from '#core/entities/agent-session.js';
import {AgentSessionUnavailableError} from '#core/errors.js';
import {getSessionById} from '#db/index.js';

export interface ResolvedLeasedSession {
  /** Workflows-resolved step context for the leased attempt. */
  context: Awaited<ReturnType<WorkflowsModuleClient['getLeasedAgentSessionContext']>>;
  /** The registry row the step's recorded descriptor resolves to. */
  session: AgentSession;
}

/**
 * Shared lease resolution for the session transcript routes, mirroring the
 * logs append route: the lease token narrows the request to the step attempt
 * currently dispatched to the runner, and the workflows inter-module method
 * re-verifies the lease against the runner registry and resolves the step
 * context (the `getStepLogContext` equivalent for sessions). The recorded
 * descriptor names the registry row; the row is loaded here with the
 * workflows-resolved scope as a defense-in-depth boundary, so a forwarded
 * descriptor can never reach another workspace's or run attempt's session.
 */
export async function resolveLeasedSessionForStep(params: {
  workflows: WorkflowsModuleClient;
  request: object;
  stepId: string;
  attempt: number;
}): Promise<ResolvedLeasedSession> {
  const leasedJob = requireLeasedJobContext(params.request);

  if (
    leasedJob.currentStepId !== params.stepId ||
    leasedJob.currentStepAttempt !== params.attempt
  ) {
    throw new ClientError('Step not found for leased job execution', 'step-not-found', {
      status: 404,
    });
  }

  const context = await params.workflows.getLeasedAgentSessionContext({
    jobId: leasedJob.jobId,
    jobExecutionId: leasedJob.jobExecutionId,
    runnerSessionId: leasedJob.runnerSessionId,
    stepId: params.stepId,
    attempt: params.attempt,
  });

  if (context.session === null) {
    throw new ClientError('Step has no agent session', 'session-not-found', {status: 404});
  }

  const session = await getSessionById(context.session.id);
  if (
    !session ||
    session.workspaceId !== context.workspaceId ||
    session.workflowRunAttemptId !== context.workflowRunAttemptId
  ) {
    throw new ClientError('Agent session not found for step', 'session-not-found', {status: 404});
  }

  return {context, session};
}

/**
 * Maps the session routes' domain failures to stable HTTP responses. The
 * workflows lease-resolution errors keep the same statuses the workflows
 * leased-step routes use; artifact-store failures surface as the
 * `agent_session_unavailable` family so the runner can fail the attempt
 * deterministically.
 */
export function toSessionTranscriptRouteError(error: unknown): never {
  if (
    isInterModuleKnownError(
      workflowsInterModuleContract.methods.getLeasedAgentSessionContext,
      error,
    )
  ) {
    switch (error.code) {
      case 'lease-not-active':
        throw new ClientError('Job lease is no longer active', 'lease-not-active', {
          status: 404,
          cause: error,
        });
      case 'step-not-found':
        throw new ClientError('Step not found for leased job', 'step-not-found', {
          status: 404,
          cause: error,
        });
      case 'job-not-found':
        throw new ClientError('Leased job not found', 'job-not-found', {
          status: 404,
          cause: error,
        });
      case 'step-attempt-mismatch':
        throw new ClientError(
          'Step attempt does not match current attempt',
          'step-attempt-mismatch',
          {
            status: 409,
            cause: error,
          },
        );
      case 'step-not-running':
        throw new ClientError('Step is not running', 'step-not-running', {
          status: 409,
          cause: error,
        });
      case 'leased-step-not-agent':
        throw new ClientError('Step is not an agent step', 'leased-step-not-agent', {
          status: 409,
          cause: error,
        });
      case 'step-session-config-invalid':
        throw new ClientError('Step session recording is invalid', 'step-session-config-invalid', {
          status: 409,
          cause: error,
        });
    }
  }

  if (error instanceof AgentSessionUnavailableError) {
    if (error.reason === 'blob_cap_exceeded') {
      throw new ClientError(
        'Session transcript blob exceeds the platform cap',
        'blob-cap-exceeded',
        {
          status: 413,
          details: {max_bytes: config.AGENT_SESSION_BLOB_CAP_BYTES},
        },
      );
    }
    throw new ClientError('Session transcript is unavailable', 'session-unavailable', {
      status: 503,
      details: {reason: error.reason},
    });
  }

  // The raw-body parser limit sits a margin above the cap as a memory guard;
  // a blob over that limit is rejected by Fastify before the handler runs.
  // Surface it under the same contract as the store's precise cap check so a
  // runner keying retry/cap logic on `blob-cap-exceeded` never sees two codes
  // for the same logical rejection.
  if (error instanceof Error && 'code' in error && error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    throw new ClientError('Session transcript blob exceeds the platform cap', 'blob-cap-exceeded', {
      status: 413,
      details: {max_bytes: config.AGENT_SESSION_BLOB_CAP_BYTES},
    });
  }

  throw error;
}
