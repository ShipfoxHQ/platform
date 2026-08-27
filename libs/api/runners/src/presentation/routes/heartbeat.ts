import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {heartbeatBodySchema, heartbeatResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {RunningJobExecutionNotFoundError} from '#core/errors.js';
import {recordHeartbeat} from '#db/job-executions.js';

export function createHeartbeatRoute(auth: AuthInterModuleClient) {
  return defineRoute({
    method: 'POST',
    path: '/:jobId/heartbeat',
    description:
      'Keeps a running job execution alive while the runner is still working on it. Returns whether the server has asked the runner to cancel.',
    schema: {
      params: z.object({jobId: z.string().uuid()}),
      body: heartbeatBodySchema.nullish(),
      response: {
        200: heartbeatResponseSchema,
      },
    },
    errorHandler: (error) => {
      if (error instanceof RunningJobExecutionNotFoundError) {
        throw new ClientError(error.message, 'running-job-execution-not-found', {status: 404});
      }
      throw error;
    },
    handler: async (request) => {
      const {jobId} = request.params;
      const lease = requireLeasedJobContext(request);
      if (lease.jobId !== jobId) {
        throw new ClientError('Lease token does not match job', 'lease-job-mismatch', {
          status: 404,
        });
      }

      const heartbeatResult = await recordHeartbeat({
        jobExecutionId: lease.jobExecutionId,
        runnerSessionId: lease.runnerSessionId,
        toolCapabilities: request.body?.capabilities ?? null,
      });

      if (
        heartbeatResult.previousToolCapabilities &&
        !sameToolCapabilities(
          heartbeatResult.previousToolCapabilities,
          heartbeatResult.currentToolCapabilities,
        )
      ) {
        request.log.info(
          {
            runnerSessionId: lease.runnerSessionId,
            jobExecutionId: lease.jobExecutionId,
            previousHarnesses: Object.keys(heartbeatResult.previousToolCapabilities.harnesses),
            currentHarnesses: heartbeatResult.currentToolCapabilities
              ? Object.keys(heartbeatResult.currentToolCapabilities.harnesses)
              : [],
          },
          'Runner heartbeat changed advertised tool capabilities',
        );
      }

      const {token: leaseToken} = await auth.mintJobLeaseToken({
        workflowRunId: heartbeatResult.runningJobExecution.workflowRunId,
        workflowRunAttemptId: heartbeatResult.runningJobExecution.workflowRunAttemptId,
        jobId: heartbeatResult.runningJobExecution.jobId,
        jobExecutionId: heartbeatResult.runningJobExecution.jobExecutionId,
        projectId: heartbeatResult.runningJobExecution.projectId,
        workspaceId: heartbeatResult.runningJobExecution.workspaceId,
        runnerSessionId: heartbeatResult.runningJobExecution.runnerSessionId,
        ...(lease.currentStepId && lease.currentStepAttempt !== undefined
          ? {currentStepId: lease.currentStepId, currentStepAttempt: lease.currentStepAttempt}
          : {}),
      });

      return {
        cancel: heartbeatResult.cancellationRequested,
        lease_token: leaseToken,
        ...(heartbeatResult.cancellationReason
          ? {cancellation_reason: heartbeatResult.cancellationReason}
          : {}),
      };
    },
  });
}

function sameToolCapabilities(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
