import type {UserContextMembership} from '@shipfox/api-auth-context';
import {emailSchema} from '@shipfox/api-common-dto';
import {generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {config} from '#config.js';
import {
  createInvitation,
  findInvitationById,
  findInvitationByToken,
  listOpenInvitationsByWorkspace,
  reconcileInvitationAcceptance,
  revokeInvitation,
} from '#db/invitations.js';
import {getWorkspaceById} from '#db/workspaces.js';
import type {Invitation} from './entities/invitation.js';
import type {Membership} from './entities/membership.js';
import {
  InvitationEmailMismatchError,
  InvitationNotFoundError,
  InvitationWorkspaceMismatchError,
  TokenAlreadyUsedError,
  TokenExpiredError,
  TokenInvalidError,
} from './errors.js';
import {requireWorkspaceMembership} from './workspaces.js';

const INVITATION_TTL_DAYS = 7;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function nonBlankOrFallback(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export async function createWorkspaceInvitation(params: {
  workspaceId: string;
  email: string;
  invitedByUserId: string;
  invitedByDisplay?: string | null;
  invitedByMemberships: ReadonlyArray<UserContextMembership>;
}): Promise<Invitation> {
  const email = emailSchema.parse(params.email);
  const {workspace} = await requireWorkspaceMembership({
    workspaceId: params.workspaceId,
    userId: params.invitedByUserId,
    memberships: params.invitedByMemberships,
    enforceWorkspaceStatus: false,
  });

  const rawToken = generateOpaqueToken('invitation');
  const invitation = await createInvitation({
    workspaceId: params.workspaceId,
    email,
    hashedToken: hashOpaqueToken(rawToken),
    expiresAt: daysFromNow(INVITATION_TTL_DAYS),
    invitedByUserId: params.invitedByUserId,
    invitedByDisplay: params.invitedByDisplay ?? null,
    sendEmail: {
      workspaceName: nonBlankOrFallback(workspace.name, 'your workspace'),
      inviterName: nonBlankOrFallback(params.invitedByDisplay, 'A teammate'),
      inviteLink: `${config.CLIENT_BASE_URL}/invitations/accept?token=${rawToken}`,
    },
  });

  return invitation;
}

export async function peekInvitationByRawToken(params: {
  token: string;
}): Promise<Invitation | undefined> {
  return await findInvitationByToken({hashedToken: hashOpaqueToken(params.token)});
}

export type PreviewInvitationResult =
  | {
      status: 'pending';
      workspaceId: string;
      workspaceName: string;
      email: string;
      invitedByDisplay: string | null;
      expiresAt: Date;
    }
  | {status: 'expired'; workspaceName: string; expiresAt: Date}
  | {status: 'already_used'; workspaceName: string}
  | {status: 'invalid'};

export interface AcceptedWorkspaceInvitation {
  invitation: Invitation;
  membership: Membership;
  alreadyMember: boolean;
}

export async function previewInvitation(params: {token: string}): Promise<PreviewInvitationResult> {
  const invitation = await peekInvitationByRawToken({token: params.token});
  if (!invitation) {
    return {status: 'invalid'};
  }

  const workspace = await getWorkspaceById(invitation.workspaceId);
  if (!workspace) {
    // Workspace cascade-deleted — the invitation row is orphaned. Treat as invalid.
    return {status: 'invalid'};
  }

  if (invitation.revokedAt !== null) {
    return {status: 'invalid'};
  }

  if (invitation.acceptedAt !== null) {
    return {status: 'already_used', workspaceName: workspace.name};
  }

  if (invitation.expiresAt.getTime() <= Date.now()) {
    return {
      status: 'expired',
      workspaceName: workspace.name,
      expiresAt: invitation.expiresAt,
    };
  }

  return {
    status: 'pending',
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    email: invitation.email,
    invitedByDisplay: invitation.invitedByDisplay,
    expiresAt: invitation.expiresAt,
  };
}

export async function acceptWorkspaceInvitation(params: {
  token: string;
  userId: string;
  email: string;
  name?: string | null | undefined;
}): Promise<AcceptedWorkspaceInvitation> {
  const result = await reconcileWorkspaceInvitationAcceptance({
    token: params.token,
    email: params.email,
    userId: params.userId,
    name: params.name,
  });
  if (result.status === 'accepted') {
    return {
      invitation: result.invitation,
      membership: result.membership,
      alreadyMember: result.alreadyMember,
    };
  }
  if (result.status === 'already_accepted' || result.status === 'consumed_by_another_user') {
    throw new TokenAlreadyUsedError();
  }
  if (result.status === 'expired') {
    throw new TokenExpiredError();
  }
  if (result.status === 'email_mismatch') {
    throw new InvitationEmailMismatchError();
  }
  throw new TokenInvalidError(
    result.status === 'revoked' ? 'Invitation token has been revoked' : 'Invitation is invalid',
  );
}

export type WorkspaceInvitationReconciliation =
  | {
      status: 'accepted' | 'already_accepted';
      invitation: Invitation;
      membership: Membership;
      alreadyMember: boolean;
    }
  | {
      status: 'invalid' | 'expired' | 'revoked' | 'consumed_by_another_user' | 'email_mismatch';
    };

export async function reconcileWorkspaceInvitationAcceptance(params: {
  token: string;
  userId: string;
  email: string;
  name?: string | null | undefined;
}): Promise<WorkspaceInvitationReconciliation> {
  const invitation = await peekInvitationByRawToken({token: params.token});
  if (!invitation) return {status: 'invalid'};

  const result = await reconcileInvitationAcceptance({
    invitationId: invitation.id,
    acceptedByUserId: params.userId,
    email: emailSchema.parse(params.email),
    acceptedByUserName: params.name,
  });
  if (result.status === 'accepted') {
    return {
      status: result.status,
      invitation: result.invitation,
      membership: result.membership,
      alreadyMember: result.alreadyMember,
    };
  }
  if (result.status === 'already_accepted') {
    return {
      status: result.status,
      invitation: result.invitation,
      membership: result.membership,
      alreadyMember: true,
    };
  }
  return result;
}

export async function listWorkspaceInvitations(params: {
  workspaceId: string;
  requesterUserId: string;
  requesterMemberships: ReadonlyArray<UserContextMembership>;
}): Promise<Invitation[]> {
  await requireWorkspaceMembership({
    workspaceId: params.workspaceId,
    userId: params.requesterUserId,
    memberships: params.requesterMemberships,
    enforceWorkspaceStatus: false,
  });

  return listOpenInvitationsByWorkspace({workspaceId: params.workspaceId});
}

export async function revokeWorkspaceInvitation(params: {
  workspaceId: string;
  requesterUserId: string;
  requesterMemberships: ReadonlyArray<UserContextMembership>;
  invitationId: string;
}): Promise<void> {
  await requireWorkspaceMembership({
    workspaceId: params.workspaceId,
    userId: params.requesterUserId,
    memberships: params.requesterMemberships,
    enforceWorkspaceStatus: false,
  });

  const invitation = await findInvitationById({id: params.invitationId});
  if (!invitation) {
    throw new InvitationNotFoundError(params.invitationId);
  }

  if (invitation.workspaceId !== params.workspaceId) {
    throw new InvitationWorkspaceMismatchError();
  }

  await revokeInvitation({invitationId: params.invitationId});
}
