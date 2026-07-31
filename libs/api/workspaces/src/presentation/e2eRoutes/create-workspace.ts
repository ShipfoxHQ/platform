import {
  e2eCreateWorkspaceBodySchema,
  e2eCreateWorkspaceResponseSchema,
} from '@shipfox/api-workspaces-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {WorkspaceSlugConflictError} from '#core/errors.js';
import {createWorkspaceForUser} from '#core/index.js';
import {toWorkspaceDto} from '#presentation/dto/index.js';

export const createE2eWorkspaceRoute = defineRoute({
  method: 'POST',
  path: '/',
  description: 'Create a workspace for an existing user for E2E tests.',
  schema: {
    body: e2eCreateWorkspaceBodySchema,
    response: {
      201: e2eCreateWorkspaceResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof WorkspaceSlugConflictError) {
      throw new ClientError('Workspace slug is already taken', 'slug-conflict', {status: 409});
    }
    throw error;
  },
  handler: async (request, reply) => {
    const workspace = await createWorkspaceForUser({
      name: request.body.name,
      slug: request.body.slug ?? `e2e-workspace-${crypto.randomUUID().slice(0, 8)}`,
      userId: request.body.user_id,
      userEmail: request.body.user_email,
      userName: request.body.user_name,
    });

    reply.code(201);
    return toWorkspaceDto(workspace);
  },
});
