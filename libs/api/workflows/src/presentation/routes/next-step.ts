import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {
  nextStepResponseSchema,
  RUNNER_NEXT_STEP_RESPONSE_BUDGET_BYTES,
} from '@shipfox/api-workflows-dto';
import {captureException} from '@shipfox/node-error-monitoring';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {warnAgentToolCapabilityMismatchOnDispatch} from '#core/agent-tool-capability-warning.js';
import {JobNotFoundError} from '#core/errors.js';
import {nextStepForLeasedJobExecution} from '#core/job-execution.js';
import type {RuntimeCompletionStatus} from '#core/workflow-scheduling/runtime-dag.js';
import {
  recordWorkflowNextStepResponseOverflow,
  recordWorkflowNextStepResponseSize,
} from '#metrics/instance.js';
import {toStepDto} from '#presentation/dto/step.js';
import {serializedResponseByteLength} from './serialized-response-byte-length.js';

type NextStepRouteResponse =
  | {kind: 'step'; step: ReturnType<typeof toStepDto>; attempt: number; lease_token: string}
  | {kind: 'wait'; retry_after_ms: number}
  | {kind: 'done'; status: RuntimeCompletionStatus};

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

      let response: NextStepRouteResponse;
      if (next.kind === 'step') {
        const {token: leaseToken} = await params.auth.mintJobLeaseToken({
          workflowRunId: leasedJob.workflowRunId,
          ...(leasedJob.workflowRunAttempt === undefined
            ? {}
            : {workflowRunAttempt: leasedJob.workflowRunAttempt}),
          workflowRunAttemptId: leasedJob.workflowRunAttemptId,
          jobId: leasedJob.jobId,
          jobExecutionId: leasedJob.jobExecutionId,
          projectId: leasedJob.projectId,
          workspaceId: leasedJob.workspaceId,
          runnerSessionId: leasedJob.runnerSessionId,
          currentStepId: next.step.id,
          currentStepAttempt: next.step.currentAttempt,
        });
        if (next.dispatched) {
          await warnAgentToolCapabilityMismatchOnDispatch({
            annotations: params.annotations,
            runners: params.runners,
            leaseIdentity: leasedJob,
            step: next.step,
          });
        }
        // The runner echoes this back on report so a stale report from a superseded
        // attempt is ignored.
        response = {
          kind: 'step' as const,
          step: toStepDto(next.step),
          attempt: next.step.currentAttempt,
          lease_token: leaseToken,
        };
      } else if (next.kind === 'wait') {
        params.toolStepExecutor?.nudge();
        response = {kind: 'wait' as const, retry_after_ms: next.retryAfterMs};
      } else {
        response = {kind: 'done' as const, status: next.status};
      }

      const serializedResponse = reply.serialize(response);
      const responseBytes = serializedResponseByteLength(serializedResponse);
      recordWorkflowNextStepResponseSize(response.kind, responseBytes);
      if (responseBytes > RUNNER_NEXT_STEP_RESPONSE_BUDGET_BYTES) {
        recordWorkflowNextStepResponseOverflow(response.kind);
        const error = new Error('Workflow next-step response exceeded its byte budget');
        logger().error(
          {
            error,
            kind: response.kind,
            responseBytes,
            limitBytes: RUNNER_NEXT_STEP_RESPONSE_BUDGET_BYTES,
          },
          'Workflow next-step response exceeded its byte budget; serving the step',
        );
        captureException(error);
      }
      return reply.type('application/json').send(serializedResponse);
    },
  });
}
