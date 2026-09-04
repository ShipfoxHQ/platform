import {AUTH_USER, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {jobExecutionUsageResponseSchema} from '@shipfox/api-usage-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listInferenceSegmentsForJobExecution} from '#db/inference-segments.js';
import {getJobExecutionUsage} from '#db/job-executions.js';
import {toInferenceSegmentUsageDto, toJobExecutionUsageDto} from '../dto.js';

export const getJobExecutionUsageRoute = defineRoute({
  method: 'GET',
  path: '/job-executions/:job_execution_id',
  auth: AUTH_USER,
  description: 'Get Usage records for one job execution.',
  schema: {
    params: z.object({workspace_id: z.string().uuid(), job_execution_id: z.string().uuid()}),
    response: {200: jobExecutionUsageResponseSchema},
  },
  handler: async (request) => {
    const {workspace_id: workspaceId, job_execution_id: jobExecutionId} = request.params;
    requireWorkspaceAccess({request, workspaceId});
    const jobExecution = await getJobExecutionUsage({workspaceId, jobExecutionId});
    if (!jobExecution) {
      throw new ClientError('Usage not found', 'not-found', {status: 404});
    }
    const segments = await listInferenceSegmentsForJobExecution({workspaceId, jobExecutionId});
    return {
      job_execution: toJobExecutionUsageDto(jobExecution),
      inference_segments: segments.map(toInferenceSegmentUsageDto),
    };
  },
});
