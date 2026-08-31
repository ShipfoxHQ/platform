import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {nextStepResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {warnAgentToolCapabilityMismatchOnDispatch} from '#core/agent-tool-capability-warning.js';
import {JobNotFoundError} from '#core/errors.js';
import {nextStepForLeasedJobExecution} from '#core/job-execution.js';
import {toStepDto} from '#presentation/dto/step.js';

export function createNextStepRoute(params: {
  agent: AgentInterModuleClient;
  annotations: AnnotationsInterModuleClient;
  auth: AuthInterModuleClient;
  runners: RunnersInterModuleClient;
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
    handler: async (request) => {
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
        return {
          kind: 'step' as const,
          step: toStepDto(next.step),
          attempt: next.step.currentAttempt,
          lease_token: leaseToken,
        };
      }
      if (next.kind === 'wait') {
        return {kind: 'wait' as const, retry_after_ms: next.retryAfterMs};
      }
      return {kind: 'done' as const, status: next.status};
    },
  });
}
