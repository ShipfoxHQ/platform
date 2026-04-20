import {getApiKeyContext} from '@shipfox/api-auth-context';
import {jobDtoSchema, runResponseSchema, stepDtoSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getJobsByRunId, getStepsByJobIds, getWorkflowRunById} from '#db/index.js';
import {toJobDto, toRunDto, toStepDto} from '#presentation/dto/index.js';

const runDetailResponseSchema = runResponseSchema.extend({
  jobs: z.array(
    jobDtoSchema.extend({
      steps: z.array(stepDtoSchema),
    }),
  ),
});

export const getRunRoute = defineRoute({
  method: 'GET',
  path: '/:id',
  description: 'Get a workflow run by ID with jobs and steps',
  schema: {
    params: z.object({
      id: z.string().uuid(),
    }),
    response: {
      200: runDetailResponseSchema,
    },
  },
  handler: async (request) => {
    const {id} = request.params;
    const apiKeyContext = getApiKeyContext(request);
    if (!apiKeyContext) {
      throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    }

    const run = await getWorkflowRunById(id);

    if (!run || run.workspaceId !== apiKeyContext.workspaceId) {
      throw new ClientError('Run not found', 'not-found', {status: 404});
    }

    const runJobs = await getJobsByRunId(run.id);
    const allSteps = await getStepsByJobIds(runJobs.map((j) => j.id));

    const jobDtos = runJobs.map((job) => ({
      ...toJobDto(job),
      steps: allSteps.filter((s) => s.jobId === job.id).map(toStepDto),
    }));

    return {
      ...toRunDto(run),
      jobs: jobDtos,
    };
  },
});
