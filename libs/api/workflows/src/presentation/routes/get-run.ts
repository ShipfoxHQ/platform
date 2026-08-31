import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {workflowRunDetailResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getWorkflowRunDetail} from '#db/index.js';
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
      await requireAccessibleRun({request, id, projects});

      const run = await getWorkflowRunDetail(id, request.query.attempt);
      if (!run) {
        throw new ClientError('Run not found', 'not-found', {status: 404});
      }

      return toRunDetailDto(run);
    },
  });
}
