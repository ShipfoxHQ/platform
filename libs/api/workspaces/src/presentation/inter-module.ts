import {workspacesInterModuleContract} from '@shipfox/api-workspaces-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {
  InvitationEmailMismatchError,
  MembershipRequiredError,
  TokenAlreadyUsedError,
  TokenExpiredError,
  TokenInvalidError,
  WorkspaceInactiveError,
  WorkspaceNotFoundError,
} from '#core/errors.js';
import {acceptWorkspaceInvitation, peekInvitationByRawToken} from '#core/invitations.js';
import {
  getWorkspaceCreator,
  getWorkspaceOperatingState,
  requireWorkspaceMembership,
} from '#core/workspaces.js';
import {listMembershipsByUser} from '#db/memberships.js';

export function createWorkspacesInterModulePresentation(): InterModulePresentation<
  typeof workspacesInterModuleContract
> {
  return defineInterModulePresentation(workspacesInterModuleContract, {
    listMembershipsForTokenClaims: async ({userId}) => ({
      memberships: (await listMembershipsByUser({userId})).map(
        ({workspaceId, workspaceStatus}) => ({
          workspaceId,
          role: 'admin' as const,
          workspaceStatus,
        }),
      ),
    }),
    getWorkspaceCreator: async (input) => {
      try {
        return {creatorUserId: await getWorkspaceCreator(input)};
      } catch (error) {
        if (error instanceof WorkspaceNotFoundError) {
          throw createInterModuleKnownError(
            workspacesInterModuleContract.methods.getWorkspaceCreator,
            'workspace-not-found',
            {workspaceId: input.workspaceId},
          );
        }
        throw error;
      }
    },
    getWorkspaceOperatingState: async (input) => {
      try {
        return {status: await getWorkspaceOperatingState(input)};
      } catch (error) {
        if (error instanceof WorkspaceNotFoundError) {
          throw createInterModuleKnownError(
            workspacesInterModuleContract.methods.getWorkspaceOperatingState,
            'workspace-not-found',
            {workspaceId: input.workspaceId},
          );
        }
        throw error;
      }
    },
    preflightInvitationAcceptance: async (input) => {
      try {
        const invitation = await peekInvitationByRawToken({token: input.token});
        if (!invitation) throw new TokenInvalidError('Invitation token is invalid');
        if (invitation.acceptedAt !== null) throw new TokenAlreadyUsedError();
        if (invitation.expiresAt.getTime() <= Date.now()) throw new TokenExpiredError();
        if (invitation.email !== input.email) throw new InvitationEmailMismatchError();
        return {};
      } catch (error) {
        throw toInvitationKnownError('preflightInvitationAcceptance', error);
      }
    },
    acceptInvitation: async (input) => {
      try {
        const result = await acceptWorkspaceInvitation(input);
        return {
          membership: {
            id: result.membership.id,
            userId: result.membership.userId,
            workspaceId: result.membership.workspaceId,
          },
        };
      } catch (error) {
        throw toInvitationKnownError('acceptInvitation', error);
      }
    },
    requireActiveMembership: async (input) => {
      try {
        await requireWorkspaceMembership(input);
        return {};
      } catch (error) {
        const method = workspacesInterModuleContract.methods.requireActiveMembership;
        if (error instanceof MembershipRequiredError)
          throw createInterModuleKnownError(method, 'membership-required', {
            workspaceId: input.workspaceId,
          });
        if (error instanceof WorkspaceNotFoundError)
          throw createInterModuleKnownError(method, 'workspace-not-found', {
            workspaceId: input.workspaceId,
          });
        if (error instanceof WorkspaceInactiveError)
          throw createInterModuleKnownError(method, 'workspace-inactive', {
            workspaceId: input.workspaceId,
          });
        throw error;
      }
    },
  });
}

function toInvitationKnownError(
  methodName: 'preflightInvitationAcceptance' | 'acceptInvitation',
  error: unknown,
): unknown {
  const method = workspacesInterModuleContract.methods[methodName];
  if (error instanceof TokenInvalidError)
    return createInterModuleKnownError(method, 'invitation-token-invalid', {});
  if (error instanceof TokenAlreadyUsedError)
    return createInterModuleKnownError(method, 'invitation-token-used', {});
  if (error instanceof TokenExpiredError)
    return createInterModuleKnownError(method, 'invitation-token-expired', {});
  if (error instanceof InvitationEmailMismatchError)
    return createInterModuleKnownError(method, 'invitation-email-mismatch', {});
  return error;
}
