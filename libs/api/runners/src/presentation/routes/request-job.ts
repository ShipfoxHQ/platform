import {jobPayloadResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {claimJob} from '#db/jobs.js';
import {getRunnerContext} from '#presentation/auth/index.js';

export const requestJobRoute = defineRoute({
  method: 'POST',
  path: '/request',
  description: 'Get the next available job for the runner to run',
  schema: {
    response: {
      200: jobPayloadResponseSchema,
    },
  },
  handler: async (_request, reply) => {
    const runner = getRunnerContext(_request);
    if (runner.revokedAt) {
      throw new ClientError('Runner token has been revoked', 'runner-token-revoked', {
        status: 401,
      });
    }

    const job = await claimJob({
      workspaceId: runner.workspaceId,
      runnerTokenId: runner.runnerTokenId,
    });

    if (!job) {
      reply.status(204);
      return;
    }

    return {
      job_id: job.jobId,
      run_id: job.runId,
      job_name: job.payload.job_name,
      steps: job.payload.steps,
    };
  },
});
