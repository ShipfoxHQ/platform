import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  WORKFLOW_RUN_DETAIL_REQUEST_KIND_HEADER,
  workflowRunDetailResponseSchema,
} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getWorkflowRunDetail, type WorkflowRunDetailReadMeasurement} from '#db/index.js';
import {
  classifyWorkflowRunDetailRequestKind,
  recordWorkflowRunDetailRead,
  type WorkflowRunDetailReadOutcome,
} from '#metrics/instance.js';
import {toRunDetailDto} from '#presentation/dto/index.js';
import {requireAccessibleRun} from './require-accessible-run.js';

export function getRunRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/:id',
    description: 'Get a workflow run by ID with jobs and steps',
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
      querystring: z.object({
        attempt: z.coerce.number().int().positive().optional(),
      }),
      response: {
        200: workflowRunDetailResponseSchema,
      },
    },
    handler: async (request) => {
      const {id} = request.params;
      const startedAt = performance.now();
      const requestKind = classifyWorkflowRunDetailRequestKind(
        request.headers[WORKFLOW_RUN_DETAIL_REQUEST_KIND_HEADER],
      );
      let readAttempted = false;
      let readMeasurement: WorkflowRunDetailReadMeasurement | undefined;
      let responseBytes = 0;
      let outcome: WorkflowRunDetailReadOutcome = 'success';

      try {
        await requireAccessibleRun({request, id, projects});

        readAttempted = true;
        const run = await getWorkflowRunDetail(id, request.query.attempt, undefined, {
          onRead: (measurement) => {
            readMeasurement = measurement;
          },
        });
        if (!run) {
          outcome = 'not_found';
          throw new ClientError('Run not found', 'not-found', {status: 404});
        }

        const response = toRunDetailDto(run);
        responseBytes = Buffer.byteLength(JSON.stringify(response), 'utf8');
        return response;
      } catch (error) {
        if (outcome === 'success') outcome = 'error';
        throw error;
      } finally {
        if (readAttempted) {
          recordWorkflowRunDetailRead({
            durationMilliseconds: performance.now() - startedAt,
            databaseDurationMilliseconds: readMeasurement?.databaseDurationMilliseconds ?? 0,
            responseBytes,
            returnedRows: readMeasurement?.returnedRows ?? 0,
            requestKind,
            outcome,
          });
        }
      }
    },
  });
}
