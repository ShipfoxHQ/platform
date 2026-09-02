import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {workflowRunSourceResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getWorkflowRunSource} from '#db/index.js';
import {toWorkflowRunSourceResponseDto} from '#presentation/dto/index.js';
import {requireAccessibleRunScope} from './require-accessible-run.js';

export function getRunSourceRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/:id/source',
    description: 'Get the immutable source snapshot for a workflow run',
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
      response: {
        200: workflowRunSourceResponseSchema,
      },
    },
    handler: async (request) => {
      await requireAccessibleRunScope({request, id: request.params.id, projects});
      const source = await getWorkflowRunSource(request.params.id);
      if (!source) {
        throw new ClientError('Run source not found', 'not-found', {status: 404});
      }

      return toWorkflowRunSourceResponseDto(source);
    },
  });
}
