import {AUTH_USER, getUserContext} from '@shipfox/api-auth-context';
import {createWorkspaceBodySchema, workspaceResponseSchema} from '@shipfox/api-workspaces-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
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
  handler: async (request, reply) => {
    const client = getUserContext(request);
    if (!client) {
      throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    }

    const {name} = request.body;

    const workspace = await createWorkspaceForUser({
      name,
      userId: client.userId,
      userEmail: client.email,
    });

    reply.code(201);
    return toWorkspaceDto(workspace);
  },
});
