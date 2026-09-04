import {AUTH_USER, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {runUsageResponseSchema} from '@shipfox/api-usage-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listInferenceSegmentsForRun} from '#db/inference-segments.js';
import {listJobExecutionsForRun} from '#db/job-executions.js';
import {toInferenceSegmentUsageDto, toJobExecutionUsageDto} from '../dto.js';

export const getRunUsageRoute = defineRoute({
  method: 'GET',
  path: '/runs/:run_id',
  auth: AUTH_USER,
  description: 'Get Usage records for a workflow run.',
  schema: {
    params: z.object({workspace_id: z.string().uuid(), run_id: z.string().uuid()}),
    response: {200: runUsageResponseSchema},
  },
  handler: async (request) => {
    const {workspace_id: workspaceId, run_id: workflowRunId} = request.params;
    requireWorkspaceAccess({request, workspaceId});
    const [jobExecutions, segments] = await Promise.all([
      listJobExecutionsForRun({workspaceId, workflowRunId}),
      listInferenceSegmentsForRun({workspaceId, workflowRunId}),
    ]);
    return {
      job_executions: jobExecutions.map(toJobExecutionUsageDto),
      inference_segments: segments.map(toInferenceSegmentUsageDto),
    };
  },
});
