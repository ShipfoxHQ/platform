import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  workflowExecutionStepsQuerySchema,
  workflowExecutionStepsResponseSchema,
} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getWorkflowJobReadScope, listWorkflowExecutionSteps} from '#db/index.js';
import {toWorkflowExecutionStepsResponseDto} from '#presentation/dto/index.js';
import {requireAccessibleRunScope} from './require-accessible-run.js';
import {assertValidCursor, decodeStepCursor} from './workflow-job-cursors.js';

export function listExecutionStepsRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/jobs/:jobId/executions/:executionId/steps',
    description: 'List bounded step summaries for a workflow job execution',
    schema: {
      params: z.object({
        jobId: z.string().uuid(),
        executionId: z.string().uuid(),
      }),
      querystring: workflowExecutionStepsQuerySchema,
      response: {
        200: workflowExecutionStepsResponseSchema,
      },
    },
    handler: async (request) => {
      const {jobId, executionId} = request.params;
      const {cursor, limit} = request.query;
      const decodedCursor = decodeStepCursor(cursor);
      assertValidCursor(cursor, decodedCursor);

      const scope = await getWorkflowJobReadScope(jobId);
      if (!scope) {
        throw new ClientError('Job not found', 'not-found', {status: 404});
      }
      await requireAccessibleRunScope({request, id: scope.workflowRunId, projects});

      const page = await listWorkflowExecutionSteps({
        jobId,
        executionId,
        limit,
        cursor: decodedCursor
          ? {position: Number(decodedCursor.value), id: decodedCursor.id}
          : undefined,
      });
      if (!page) {
        throw new ClientError('Execution not found', 'not-found', {status: 404});
      }

      return toWorkflowExecutionStepsResponseDto(page);
    },
  });
}
