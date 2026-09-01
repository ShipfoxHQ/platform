import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  workflowStepAttemptSummariesQuerySchema,
  workflowStepAttemptSummariesResponseSchema,
} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getWorkflowStepReadScope, listWorkflowStepAttemptSummaries} from '#db/index.js';
import {toWorkflowStepAttemptSummariesResponseDto} from '#presentation/dto/index.js';
import {requireAccessibleRunScope} from './require-accessible-run.js';
import {assertValidCursor, decodeAttemptCursor} from './workflow-job-cursors.js';

export function listStepAttemptsRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/steps/:stepId/attempts',
    description: 'List bounded attempt summaries for a workflow step',
    schema: {
      params: z.object({
        stepId: z.string().uuid(),
      }),
      querystring: workflowStepAttemptSummariesQuerySchema,
      response: {
        200: workflowStepAttemptSummariesResponseSchema,
      },
    },
    handler: async (request) => {
      const {stepId} = request.params;
      const {cursor, limit} = request.query;
      const decodedCursor = decodeAttemptCursor(cursor);
      assertValidCursor(cursor, decodedCursor);

      const scope = await getWorkflowStepReadScope(stepId);
      if (!scope) {
        throw new ClientError('Step not found', 'not-found', {status: 404});
      }
      await requireAccessibleRunScope({request, id: scope.workflowRunId, projects});

      const page = await listWorkflowStepAttemptSummaries({
        stepId,
        limit,
        cursor: decodedCursor ? {attempt: decodedCursor.value, id: decodedCursor.id} : undefined,
      });
      if (!page) {
        throw new ClientError('Step not found', 'not-found', {status: 404});
      }

      return toWorkflowStepAttemptSummariesResponseDto(page);
    },
  });
}
