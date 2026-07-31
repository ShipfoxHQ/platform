import {AUTH_USER, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {updateWorkspaceBodySchema, workspaceResponseSchema} from '@shipfox/api-workspaces-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {WorkspaceNotFoundError, WorkspaceSlugConflictError} from '#core/errors.js';
import {updateWorkspaceDetails} from '#core/index.js';
import {toWorkspaceDto} from '#presentation/dto/index.js';

export const updateWorkspaceRoute = defineRoute({
  method: 'PATCH',
  path: '/:workspaceId',
  description: 'Update workspace details.',
  auth: AUTH_USER,
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    body: updateWorkspaceBodySchema,
    response: {
      200: workspaceResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof WorkspaceNotFoundError) {
      throw new ClientError('Workspace not found', 'not-found', {status: 404});
    }
    if (error instanceof WorkspaceSlugConflictError) {
      throw new ClientError('Workspace slug is already taken', 'slug-conflict', {status: 409});
    }
    throw error;
  },
  handler: async (request) => {
    requireWorkspaceAccess({request, workspaceId: request.params.workspaceId});

    const workspace = await updateWorkspaceDetails({
      workspaceId: request.params.workspaceId,
      name: request.body.name,
      slug: request.body.slug,
    });

    return toWorkspaceDto(workspace);
  },
});
