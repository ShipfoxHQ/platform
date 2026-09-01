import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  getWorkflowRunSelectionDepth,
  workflowRunSelectionQuerySchema,
  workflowRunSelectionResponseSchema,
} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {z} from 'zod';
import {getWorkflowRunSelection} from '#db/index.js';
import {toRunSelectionDto} from '#presentation/dto/index.js';
import {requireAccessibleRun} from './require-accessible-run.js';
import {serializedResponseByteLength} from './serialized-response-byte-length.js';

export function getRunSelectionRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/:id/selection',
    description: 'Resolve a workflow run selection',
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
      querystring: workflowRunSelectionQuerySchema,
      response: {
        200: workflowRunSelectionResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const {id} = request.params;
      const query = request.query;
      const selectionDepth = getWorkflowRunSelectionDepth(query);
      const startedAt = performance.now();
      let dbDurationMilliseconds = 0;
      let responseBytes = 0;
      let resultCount = 0;
      let resolvedAttempt: number | null = null;
      let responseStatus = 200;
      let outcome: 'success' | 'not_found' | 'error' = 'success';

      try {
        const run = await requireAccessibleRun({request, id, projects});
        const selection = await getWorkflowRunSelection(
          {
            workflowRunId: run.id,
            projectId: run.projectId,
            query,
          },
          {
            onRead: (measurement) => {
              dbDurationMilliseconds = measurement.databaseDurationMilliseconds;
            },
          },
        );
        if (!selection) {
          throw new ClientError('Workflow run selection not found', 'not-found', {status: 404});
        }

        resultCount = 1;
        resolvedAttempt = selection.workflowRunAttempt;
        const response = toRunSelectionDto(selection);
        const serializedResponse = reply.serialize(response);
        responseBytes = serializedResponseByteLength(serializedResponse);
        return reply.type('application/json').send(serializedResponse);
      } catch (error) {
        responseStatus =
          error instanceof ClientError && typeof error.status === 'number' ? error.status : 500;
        outcome = responseStatus === 404 ? 'not_found' : 'error';
        throw error;
      } finally {
        logger().info(
          {
            route: 'workflow-runs/:id/selection',
            status: responseStatus,
            outcome,
            runId: id,
            selectionDepth,
            selectionMode: query.attempt === undefined ? 'derive_attempt' : 'pinned_attempt',
            attemptProvided: query.attempt !== undefined,
            resolvedAttempt,
            resultCount,
            cursorRemaining: false,
            responseBytes,
            databaseDurationMs: Math.round(dbDurationMilliseconds),
            durationMs: Math.round(performance.now() - startedAt),
          },
          'Resolved workflow run selection',
        );
      }
    },
  });
}
