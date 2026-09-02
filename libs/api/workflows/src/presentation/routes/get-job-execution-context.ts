import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {workflowJobExecutionContextResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getWorkflowJobExecutionContext, getWorkflowJobReadScope} from '#db/index.js';
import {toWorkflowJobExecutionContextResponseDto} from '#presentation/dto/index.js';
import {requireAccessibleRunScope} from './require-accessible-run.js';

export function getJobExecutionContextRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/jobs/:jobId/executions/:executionId/context',
    description: 'Get diagnostic context for one selected workflow job execution',
    schema: {
      params: z.object({
        jobId: z.string().uuid(),
        executionId: z.string().uuid(),
      }),
      response: {
        200: workflowJobExecutionContextResponseSchema,
      },
    },
    handler: async (request) => {
      const {jobId, executionId} = request.params;
      const scope = await getWorkflowJobReadScope(jobId);
      if (!scope) {
        throw new ClientError('Job not found', 'not-found', {status: 404});
      }

      await requireAccessibleRunScope({request, id: scope.workflowRunId, projects});
      const context = await getWorkflowJobExecutionContext({jobId, executionId, scope});
      if (!context) {
        throw new ClientError('Job execution not found', 'not-found', {status: 404});
      }

      return toWorkflowJobExecutionContextResponseDto(context);
    },
  });
}
