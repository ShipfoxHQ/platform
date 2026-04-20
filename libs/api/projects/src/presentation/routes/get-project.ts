import {AUTH_USER} from '@shipfox/api-auth-context';
import {projectResponseSchema} from '@shipfox/api-projects-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {requireProjectAccess} from '#presentation/auth/require-project-access.js';
import {toProjectDto} from '#presentation/dto/index.js';

export const getProjectRoute = defineRoute({
  method: 'GET',
  path: '/:projectId',
  auth: AUTH_USER,
  description: 'Get a project.',
  schema: {
    params: z.object({projectId: z.string().uuid()}),
    response: {
      200: projectResponseSchema,
    },
  },
  handler: async (request) => {
    const {projectId} = request.params;
    const {project} = await requireProjectAccess({request, projectId});
    return toProjectDto(project);
  },
});
