import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  workflowJobDetailQuerySchema,
  workflowJobDetailResponseSchema,
} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getWorkflowJobDetail, getWorkflowJobReadScope} from '#db/index.js';
import {toWorkflowJobDetailDto} from '#presentation/dto/index.js';
import {requireAccessibleRunScope} from './require-accessible-run.js';

export function getJobDetailRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/jobs/:jobId',
    description: 'Get a bounded selected execution for a workflow run job',
    schema: {
      params: z.object({
        jobId: z.string().uuid(),
      }),
      querystring: workflowJobDetailQuerySchema,
      response: {
        200: workflowJobDetailResponseSchema,
      },
    },
    handler: async (request) => {
      const {jobId} = request.params;
      const scope = await getWorkflowJobReadScope(jobId);
      if (!scope) {
        throw new ClientError('Job not found', 'not-found', {status: 404});
      }

      await requireAccessibleRunScope({request, id: scope.workflowRunId, projects});
      const detail = await getWorkflowJobDetail({
        jobId,
        executionId: request.query.execution_id,
      });
      if (!detail) {
        throw new ClientError('Job not found', 'not-found', {status: 404});
      }

      return toWorkflowJobDetailDto(detail);
    },
  });
}
