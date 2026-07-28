import {AUTH_USER, getUserContext, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  LastMemberError,
  MembershipNotFoundError,
  MembershipRequiredError,
  SelfRemovalNotAllowedError,
  WorkspaceInactiveError,
  WorkspaceNotFoundError,
} from '#core/errors.js';
import {removeWorkspaceMember} from '#core/index.js';

export const removeMemberRoute = defineRoute({
  method: 'DELETE',
  path: '/:userId',
  description: 'Remove a member from a workspace.',
  auth: AUTH_USER,
  schema: {
    params: z.object({
      workspaceId: z.string().uuid(),
      userId: z.string().uuid(),
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
    if (error instanceof MembershipNotFoundError) {
      throw new ClientError('Member not found', 'not-found', {status: 404});
    }
    if (error instanceof LastMemberError) {
      throw new ClientError(error.message, 'last-member', {status: 409});
    }
    if (error instanceof SelfRemovalNotAllowedError) {
      throw new ClientError(error.message, 'self-removal-not-allowed', {status: 409});
    }
    if (error instanceof WorkspaceInactiveError) {
      throw new ClientError('Workspace is not active', 'workspace-inactive', {status: 403});
    }
    throw error;
  },
  handler: async (request, reply) => {
    const client = getUserContext(request);
    if (!client) {
      throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    }

    const {workspaceId, userId} = request.params;
    requireWorkspaceAccess({request, workspaceId});

    await removeWorkspaceMember({
      workspaceId,
      userId,
      requesterUserId: client.userId,
      requesterMemberships: client.memberships,
    });

    reply.code(204);
  },
});
