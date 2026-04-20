import {AUTH_USER, getUserContext} from '@shipfox/api-auth-context';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  InvitationNotFoundError,
  InvitationWorkspaceMismatchError,
  MembershipRequiredError,
  WorkspaceNotFoundError,
} from '#core/errors.js';
import {revokeWorkspaceInvitation} from '#core/index.js';

export const revokeInvitationRoute = defineRoute({
  method: 'DELETE',
  path: '/:invitationId',
  description: 'Cancel a pending invitation.',
  auth: AUTH_USER,
  schema: {
    params: z.object({
      workspaceId: z.string().uuid(),
      invitationId: z.string().uuid(),
    }),
    response: {
      204: z.void(),
    },
  },
  errorHandler: (error) => {
    if (error instanceof WorkspaceNotFoundError) {
      throw new ClientError('Workspace not found', 'not-found', {status: 404});
    }
    if (error instanceof MembershipRequiredError) {
      throw new ClientError('Not a member of this workspace', 'forbidden', {status: 403});
    }
    if (error instanceof InvitationNotFoundError) {
      throw new ClientError('Invitation not found', 'not-found', {status: 404});
    }
    if (error instanceof InvitationWorkspaceMismatchError) {
      throw new ClientError('Invitation does not belong to this workspace', 'forbidden', {
        status: 403,
      });
    }
    throw error;
  },
  handler: async (request, reply) => {
    const client = getUserContext(request);
    if (!client) {
      throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    }

    const {workspaceId, invitationId} = request.params;

    await revokeWorkspaceInvitation({
      workspaceId,
      invitationId,
      requesterUserId: client.userId,
    });

    reply.code(204);
  },
});
