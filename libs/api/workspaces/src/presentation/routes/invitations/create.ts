import {AUTH_USER, getUserContext} from '@shipfox/api-auth-context';
import {createInvitationBodySchema, invitationDtoSchema} from '@shipfox/api-workspaces-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  MembershipRequiredError,
  OpenInvitationExistsError,
  WorkspaceNotFoundError,
} from '#core/errors.js';
import {createWorkspaceInvitation} from '#core/index.js';
import {toInvitationDto} from '#presentation/dto/index.js';

export const createInvitationRoute = defineRoute({
  method: 'POST',
  path: '/',
  description: 'Invite someone to join a workspace by email.',
  auth: AUTH_USER,
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    body: createInvitationBodySchema,
    response: {
      201: invitationDtoSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof WorkspaceNotFoundError) {
      throw new ClientError('Workspace not found', 'not-found', {status: 404});
    }
    if (error instanceof MembershipRequiredError) {
      throw new ClientError('Not a member of this workspace', 'forbidden', {status: 403});
    }
    if (error instanceof OpenInvitationExistsError) {
      throw new ClientError(error.message, 'open-invitation-exists', {status: 409});
    }
    throw error;
  },
  handler: async (request, reply) => {
    const client = getUserContext(request);
    if (!client) {
      throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    }

    const {workspaceId} = request.params;
    const {email} = request.body;
    const invitation = await createWorkspaceInvitation({
      workspaceId,
      email,
      invitedByUserId: client.userId,
    });

    reply.code(201);
    return toInvitationDto(invitation);
  },
});
