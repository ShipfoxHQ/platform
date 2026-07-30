import {AUTH_USER, requireUserContext} from '@shipfox/api-auth-context';
import {projectResponseSchema, updateProjectBodySchema} from '@shipfox/api-projects-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {ProjectNotFoundError, ProjectSlugConflictError, updateProjectDetails} from '#core/index.js';
import {requireProjectAccess} from '#presentation/auth/require-project-access.js';
import {toProjectDto} from '#presentation/dto/index.js';

const projectParamsSchema = z.object({
  projectId: z.string().uuid(),
});

export const updateProjectRoute = defineRoute({
  method: 'PATCH',
  path: '/:projectId',
  auth: AUTH_USER,
  description: 'Update a project.',
  schema: {
    params: projectParamsSchema,
    body: updateProjectBodySchema,
    response: {
      200: projectResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof ProjectSlugConflictError) {
      throw new ClientError('Project slug already exists', 'slug-conflict', {status: 409});
    }
    if (error instanceof ProjectNotFoundError) {
      throw new ClientError('Project not found', 'project-not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request) => {
    const {projectId} = request.params;
    await requireProjectAccess({request, projectId});
    const actor = requireUserContext(request);
    const project = await updateProjectDetails({
      actorId: actor.userId,
      projectId,
      name: request.body.name,
      slug: request.body.slug,
    });
    return toProjectDto(project);
  },
});
