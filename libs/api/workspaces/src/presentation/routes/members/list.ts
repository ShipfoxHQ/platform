import {AUTH_USER, getUserContext} from '@shipfox/api-auth-context';
import {listMembersResponseSchema} from '@shipfox/api-workspaces-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {MembershipRequiredError, WorkspaceNotFoundError} from '#core/errors.js';
import {listWorkspaceMembers} from '#core/index.js';
import {toMembershipWithUserDto} from '#presentation/dto/index.js';

export const listMembersRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'List the members of a workspace.',
  auth: AUTH_USER,
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    response: {
      200: listMembersResponseSchema,
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
    const members = await listWorkspaceMembers({workspaceId, requesterUserId: client.userId});

    return {
      members: members.map(toMembershipWithUserDto),
    };
  },
});
