import {workspaceResponseSchema} from '@shipfox/api-workspaces-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {WorkspaceNotFoundError} from '#core/errors.js';
import {getWorkspace} from '#core/index.js';
import {toWorkspaceDto} from '#presentation/dto/index.js';

export const getWorkspaceRoute = defineRoute({
  method: 'GET',
  path: '/:workspaceId',
  description: 'Get details for a workspace.',
  schema: {
    params: z.object({
      workspaceId: z.string().uuid(),
    }),
    response: {
      200: workspaceResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof WorkspaceNotFoundError) {
      throw new ClientError('Workspace not found', 'not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request) => {
    const {workspaceId} = request.params;

    const workspace = await getWorkspace({workspaceId});

    return toWorkspaceDto(workspace);
  },
});
