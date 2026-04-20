import {AUTH_USER, getUserContext} from '@shipfox/api-auth-context';
import {
  acceptInvitationBodySchema,
  acceptInvitationResponseSchema,
} from '@shipfox/api-workspaces-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {
  InvitationEmailMismatchError,
  TokenAlreadyUsedError,
  TokenExpiredError,
  TokenInvalidError,
} from '#core/errors.js';
import {acceptWorkspaceInvitation} from '#core/index.js';

export const acceptInvitationRoute = defineRoute({
  method: 'POST',
  path: '/accept',
  description: 'Accept an invitation to join a workspace.',
  auth: AUTH_USER,
  schema: {
    body: acceptInvitationBodySchema,
    response: {
      200: acceptInvitationResponseSchema,
      201: acceptInvitationResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof TokenInvalidError) {
      throw new ClientError('Invitation token is invalid', 'token-invalid', {status: 410});
    }
    if (error instanceof TokenAlreadyUsedError) {
      throw new ClientError('Invitation has already been accepted', 'token-already-used', {
        status: 410,
      });
    }
    if (error instanceof TokenExpiredError) {
      throw new ClientError('Invitation has expired', 'token-expired', {status: 410});
    }
    if (error instanceof InvitationEmailMismatchError) {
      throw new ClientError('Invitation email does not match authenticated user', 'forbidden', {
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

    const {token} = request.body;
    const result = await acceptWorkspaceInvitation({
      token,
      userId: client.userId,
      email: client.email,
    });

    reply.code(result.alreadyMember ? 200 : 201);
    return {
      membership: {
        id: result.membership.id,
        user_id: result.membership.userId,
        workspace_id: result.membership.workspaceId,
      },
      already_member: result.alreadyMember,
    };
  },
});
