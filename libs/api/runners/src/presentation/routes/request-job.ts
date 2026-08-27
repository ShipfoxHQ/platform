import {requireRunnerSessionContext} from '@shipfox/api-auth-context';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {claimedJobResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {RunnerSessionExhaustedError} from '#core/errors.js';
import {claimJobExecution} from '#core/job-executions.js';
import {getRunnerSessionById} from '#db/runner-sessions.js';

export function createRequestJobRoute(auth: AuthInterModuleClient) {
  return defineRoute({
    method: 'POST',
    path: '/request',
    description: 'Claim the next available job execution and receive its lease token',
    schema: {
      response: {
        200: claimedJobResponseSchema,
      },
    },
    errorHandler: (error) => {
      if (error instanceof RunnerSessionExhaustedError) {
        throw new ClientError('Runner session claim limit exhausted', 'runner-session-exhausted', {
          status: 409,
        });
      }
      throw error;
    },
    handler: async (_request, reply) => {
      const runner = requireRunnerSessionContext(_request);

      const session = await getRunnerSessionById(runner.runnerSessionId);
      const jobExecution = await claimJobExecution({
        auth,
        workspaceId: runner.workspaceId,
        runnerSessionId: runner.runnerSessionId,
        sessionLabels: runner.labels,
        maxClaims: runner.maxClaims,
        lifecycleCapabilities: session?.lifecycleCapabilities ?? null,
      });

      if (!jobExecution) {
        reply.status(204);
        return;
      }

      return {
        workflow_run_id: jobExecution.workflowRunId,
        workflow_run_attempt_id: jobExecution.workflowRunAttemptId,
        job_id: jobExecution.jobId,
        job_execution_id: jobExecution.jobExecutionId,
        lease_token: jobExecution.leaseToken,
        ...(jobExecution.isolationTimeoutSeconds
          ? {isolation_timeout_seconds: jobExecution.isolationTimeoutSeconds}
          : {}),
      };
    },
  });
}
