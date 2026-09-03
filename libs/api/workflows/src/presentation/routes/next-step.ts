import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {
  type NextStepResponseDto,
  nextStepResponseSchema,
  RUNNER_NEXT_STEP_RESPONSE_BUDGET_BYTES,
} from '@shipfox/api-workflows-dto';
import {captureException} from '@shipfox/node-error-monitoring';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {warnAgentToolCapabilityMismatchOnDispatch} from '#core/agent-tool-capability-warning.js';
import {JobNotFoundError} from '#core/errors.js';
import {nextStepForLeasedJobExecution} from '#core/job-execution.js';
import {
  recordWorkflowNextStepResponseOverflow,
  recordWorkflowNextStepResponseSize,
} from '#metrics/instance.js';
import {toStepDto} from '#presentation/dto/step.js';
import {serializedResponseByteLength} from './serialized-response-byte-length.js';

type NextStepRouteResponse = NextStepResponseDto;

const MAX_REPORTED_NEXT_STEP_OVERFLOWS = 1024;
const reportedNextStepOverflowKeys = new Map<string, true>();

function shouldReportNextStepOverflow(key: string): boolean {
  if (reportedNextStepOverflowKeys.has(key)) return false;

  reportedNextStepOverflowKeys.set(key, true);
  if (reportedNextStepOverflowKeys.size > MAX_REPORTED_NEXT_STEP_OVERFLOWS) {
    const oldestKey = reportedNextStepOverflowKeys.keys().next().value;
    if (oldestKey !== undefined) reportedNextStepOverflowKeys.delete(oldestKey);
  }
  return true;
}

function nextStepOverflowKey(jobExecutionId: string, response: NextStepRouteResponse): string {
  if (response.kind !== 'step') return `${jobExecutionId}:${response.kind}`;
  return `${jobExecutionId}:${response.step.id}:${response.attempt}`;
}

type LeasedJobContext = ReturnType<typeof requireLeasedJobContext>;
type NextStepResult = Awaited<ReturnType<typeof nextStepForLeasedJobExecution>>;

async function buildNextStepResponse(params: {
  next: NextStepResult;
  leasedJob: LeasedJobContext;
  annotations: AnnotationsInterModuleClient;
  auth: AuthInterModuleClient;
  runners: RunnersInterModuleClient;
}): Promise<NextStepRouteResponse> {
  if (params.next.kind === 'step') {
    const {token: leaseToken} = await params.auth.mintJobLeaseToken({
      workflowRunId: params.leasedJob.workflowRunId,
      ...(params.leasedJob.workflowRunAttempt === undefined
        ? {}
        : {workflowRunAttempt: params.leasedJob.workflowRunAttempt}),
      workflowRunAttemptId: params.leasedJob.workflowRunAttemptId,
      jobId: params.leasedJob.jobId,
      jobExecutionId: params.leasedJob.jobExecutionId,
      projectId: params.leasedJob.projectId,
      workspaceId: params.leasedJob.workspaceId,
      runnerSessionId: params.leasedJob.runnerSessionId,
      currentStepId: params.next.step.id,
      currentStepAttempt: params.next.step.currentAttempt,
    });
    if (params.next.dispatched) {
      await warnAgentToolCapabilityMismatchOnDispatch({
        annotations: params.annotations,
        runners: params.runners,
        leaseIdentity: params.leasedJob,
        step: params.next.step,
      });
    }
    // The runner echoes this back on report so a stale report from a superseded
    // attempt is ignored.
    return {
      kind: 'step',
      step: toStepDto(params.next.step),
      attempt: params.next.step.currentAttempt,
      lease_token: leaseToken,
    };
  }

  if (params.next.kind === 'wait') {
    return {kind: 'wait', retry_after_ms: params.next.retryAfterMs};
  }

  if (params.next.status !== 'succeeded' && params.next.status !== 'failed') {
    throw new Error('Workflow next-step produced unsupported completion status');
  }
  return {kind: 'done', status: params.next.status};
}

function recordNextStepResponseTelemetry(params: {
  jobExecutionId: string;
  response: NextStepRouteResponse;
  serializedResponse: Parameters<typeof serializedResponseByteLength>[0];
}): void {
  const responseBytes = serializedResponseByteLength(params.serializedResponse);
  recordWorkflowNextStepResponseSize(params.response.kind, responseBytes);
  if (responseBytes <= RUNNER_NEXT_STEP_RESPONSE_BUDGET_BYTES) return;

  recordWorkflowNextStepResponseOverflow(params.response.kind);
  if (!shouldReportNextStepOverflow(nextStepOverflowKey(params.jobExecutionId, params.response))) {
    return;
  }

  const error = new Error('Workflow next-step response exceeded its byte budget');
  logger().error(
    {
      error,
      kind: params.response.kind,
      responseBytes,
      limitBytes: RUNNER_NEXT_STEP_RESPONSE_BUDGET_BYTES,
    },
    'Workflow next-step response exceeded its byte budget; serving the step',
  );
  captureException(error);
}

export function createNextStepRoute(params: {
  agent: AgentInterModuleClient;
  annotations: AnnotationsInterModuleClient;
  auth: AuthInterModuleClient;
  runners: RunnersInterModuleClient;
  toolStepExecutor?: {nudge(): void};
}) {
  return defineRoute({
    method: 'POST',
    path: '/steps/next',
    description:
      'Returns the next step for the runner to run on its job. The job is identified by the access token, so no job ID is needed. Calling this again before reporting the current step returns that same step, so retries are safe. Server-executed tool steps return a wait response until their queued invocation settles. When no runnable steps remain, the response reports that there are no more steps to run, along with the job status; the runner then stops. Finalization is driven server-side from recorded step results and dispatch-time skips, not by the runner calling a job-completion endpoint.',
    schema: {
      response: {
        200: nextStepResponseSchema,
      },
    },
    errorHandler: (error) => {
      if (error instanceof JobNotFoundError) {
        throw new ClientError(error.message, 'job-not-found', {status: 404});
      }
      throw error;
    },
    handler: async (request, reply) => {
      const leasedJob = requireLeasedJobContext(request);
      const {active: leaseIsActive} = await params.runners.getLeaseState({
        jobId: leasedJob.jobId,
        jobExecutionId: leasedJob.jobExecutionId,
        runnerSessionId: leasedJob.runnerSessionId,
      });
      if (!leaseIsActive) {
        throw new ClientError('Job lease is no longer active', 'lease-not-active', {status: 404});
      }

      const next = await nextStepForLeasedJobExecution({
        jobExecutionId: leasedJob.jobExecutionId,
        agent: params.agent,
      });

      if (next.kind === 'wait') params.toolStepExecutor?.nudge();
      const response = await buildNextStepResponse({
        next,
        leasedJob,
        annotations: params.annotations,
        auth: params.auth,
        runners: params.runners,
      });

      const serializedResponse = reply.serialize(response);
      recordNextStepResponseTelemetry({
        jobExecutionId: leasedJob.jobExecutionId,
        response,
        serializedResponse,
      });
      return reply.type('application/json').send(serializedResponse);
    },
  });
}
