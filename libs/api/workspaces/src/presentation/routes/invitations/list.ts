import {AUTH_USER, getUserContext} from '@shipfox/api-auth-context';
import {listInvitationsResponseSchema} from '@shipfox/api-workspaces-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {MembershipRequiredError, WorkspaceNotFoundError} from '#core/errors.js';
import {listWorkspaceInvitations} from '#core/index.js';
import {toInvitationDto} from '#presentation/dto/index.js';

export const listInvitationsRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'List pending invitations for a workspace.',
  auth: AUTH_USER,
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    response: {
      200: listInvitationsResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof WorkspaceNotFoundError) {
      throw new ClientError('Workspace not found', 'not-found', {status: 404});
    }
    if (error instanceof MembershipRequiredError) {
      throw new ClientError('Not a member of this workspace', 'forbidden', {status: 403});
    }
    throw error;
  },
  handler: async (request) => {
    const client = getUserContext(request);
    if (!client) {
      throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    }

    const {workspaceId} = request.params;
    const invitations = await listWorkspaceInvitations({
      workspaceId,
      requesterUserId: client.userId,
    });

    return {
      invitations: invitations.map(toInvitationDto),
    };
  },
});
