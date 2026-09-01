import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {workflowRunLineageHeadResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {z} from 'zod';
import {getWorkflowRunLineageHead} from '#db/index.js';
import {toRunLineageHeadDto} from '#presentation/dto/index.js';
import {requireAccessibleRun} from './require-accessible-run.js';
import {serializedResponseByteLength} from './serialized-response-byte-length.js';

export function getRunLineageHeadRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/:id/head',
    description: 'Get the current and latest attempt for a workflow run',
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
      response: {
        200: workflowRunLineageHeadResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const {id} = request.params;
      const startedAt = performance.now();
      let dbDurationMilliseconds = 0;
      let responseBytes = 0;
      let resultCount = 0;
      let responseStatus = 200;
      let outcome: 'success' | 'not_found' | 'error' = 'success';

      try {
        const run = await requireAccessibleRun({request, id, projects});
        const head = await getWorkflowRunLineageHead(
          {workflowRunId: run.id, projectId: run.projectId},
          {
            onRead: (measurement) => {
              dbDurationMilliseconds = measurement.databaseDurationMilliseconds;
            },
          },
        );
        if (!head) {
          throw new ClientError('Run not found', 'not-found', {status: 404});
        }

        resultCount = 1;
        const response = toRunLineageHeadDto(head);
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
            route: 'workflow-runs/:id/head',
            status: responseStatus,
            outcome,
            runId: id,
            resultCount,
            cursorRemaining: false,
            responseBytes,
            databaseDurationMs: Math.round(dbDurationMilliseconds),
            durationMs: Math.round(performance.now() - startedAt),
          },
          'Read workflow run lineage head',
        );
      }
    },
  });
}
