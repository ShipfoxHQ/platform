import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  workflowJobExecutionSummariesQuerySchema,
  workflowJobExecutionSummariesResponseSchema,
} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getWorkflowJobReadScope, listWorkflowJobExecutionSummaries} from '#db/index.js';
import {toWorkflowJobExecutionSummariesResponseDto} from '#presentation/dto/index.js';
import {requireAccessibleRunScope} from './require-accessible-run.js';
import {assertValidCursor, decodeExecutionCursor} from './workflow-job-cursors.js';

export function listJobExecutionsRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/jobs/:jobId/executions',
    description: 'List bounded execution summaries for a workflow run job',
    schema: {
      params: z.object({
        jobId: z.string().uuid(),
      }),
      querystring: workflowJobExecutionSummariesQuerySchema,
      response: {
        200: workflowJobExecutionSummariesResponseSchema,
      },
    },
    handler: async (request) => {
      const {jobId} = request.params;
      const {cursor, limit} = request.query;
      const decodedCursor = decodeExecutionCursor(cursor);
      assertValidCursor(cursor, decodedCursor);

      const scope = await getWorkflowJobReadScope(jobId);
      if (!scope) {
        throw new ClientError('Job not found', 'not-found', {status: 404});
      }
      await requireAccessibleRunScope({request, id: scope.workflowRunId, projects});

      const page = await listWorkflowJobExecutionSummaries({
        jobId,
        limit,
        cursor: decodedCursor ? {sequence: decodedCursor.value, id: decodedCursor.id} : undefined,
      });
      if (!page) {
        throw new ClientError('Job not found', 'not-found', {status: 404});
      }

      return toWorkflowJobExecutionSummariesResponseDto(page);
    },
  });
}
