import {AUTH_USER, getUserContext} from '@shipfox/api-auth-context';
import {createWorkspaceBodySchema, workspaceResponseSchema} from '@shipfox/api-workspaces-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {WorkspaceSlugConflictError} from '#core/errors.js';
import {createWorkspaceForUser} from '#core/index.js';
import {toWorkspaceDto} from '#presentation/dto/index.js';

export const createWorkspaceRoute = defineRoute({
  method: 'POST',
  path: '/',
  description: 'Create a workspace for the signed-in user.',
  auth: AUTH_USER,
  schema: {
    body: createWorkspaceBodySchema,
    response: {
      201: workspaceResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof WorkspaceSlugConflictError) {
      throw new ClientError('Workspace slug is already taken', 'slug-conflict', {status: 409});
    }
    throw error;
  },
  handler: async (request, reply) => {
    const client = getUserContext(request);
    if (!client) {
      throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    }

    const {name, slug} = request.body;

    const workspace = await createWorkspaceForUser({
      name,
      slug,
      userId: client.userId,
      userEmail: client.email,
      userName: client.name,
    });

    reply.code(201);
    return toWorkspaceDto(workspace);
  },
});
