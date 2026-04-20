import {completeJobBodySchema, completeJobResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {RunningJobNotFoundError} from '#core/errors.js';
import {completeJob} from '#db/jobs.js';
import {getRunnerContext} from '#presentation/auth/index.js';

export const completeJobRoute = defineRoute({
  method: 'POST',
  path: '/:jobId/complete',
  description: 'Mark a runner job as finished and send its result',
  schema: {
    params: z.object({jobId: z.string().uuid()}),
    body: completeJobBodySchema,
    response: {
      200: completeJobResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof RunningJobNotFoundError) {
      throw new ClientError(error.message, 'running-job-not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request) => {
    const {jobId} = request.params;
    const {status, output} = request.body;
    const runner = getRunnerContext(request);

    await completeJob({jobId, runnerTokenId: runner.runnerTokenId}, {status, output});

    return {ok: true};
  },
});
