import {generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {config, mailer} from '#config.js';
import {
  type AcceptInvitationResult,
  acceptInvitation,
  createInvitation,
  findInvitationById,
  findInvitationByToken,
  listOpenInvitationsByWorkspace,
  revokeInvitation,
} from '#db/invitations.js';
import type {Invitation} from './entities/invitation.js';
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

export async function createWorkspaceInvitation(params: {
  workspaceId: string;
  email: string;
  invitedByUserId: string;
}): Promise<Invitation> {
  await requireWorkspaceMembership({
    workspaceId: params.workspaceId,
    userId: params.invitedByUserId,
  });

  const rawToken = generateOpaqueToken('invitation');
  const invitation = await createInvitation({
    workspaceId: params.workspaceId,
    email: params.email,
    hashedToken: hashOpaqueToken(rawToken),
    expiresAt: daysFromNow(INVITATION_TTL_DAYS),
    invitedByUserId: params.invitedByUserId,
  });

  const link = `${config.CLIENT_BASE_URL}/invitations/accept?token=${rawToken}`;
  await mailer.send({
    to: params.email,
    subject: 'You have been invited to a workspace',
    text: `Click to accept: ${link}`,
    html: `<p>Click to accept: <a href="${link}">${link}</a></p>`,
  });

  return invitation;
}

export async function acceptWorkspaceInvitation(params: {
  token: string;
  userId: string;
  email: string;
  name?: string | null | undefined;
}): Promise<AcceptInvitationResult> {
  const invitation = await findInvitationByToken({hashedToken: hashOpaqueToken(params.token)});
  if (!invitation) {
    throw new TokenInvalidError('Invitation token is invalid');
  }

  if (invitation.acceptedAt !== null) {
    throw new TokenAlreadyUsedError();
  }

  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new TokenExpiredError();
  }

  if (params.email !== invitation.email) {
    throw new InvitationEmailMismatchError();
  }

  const result = await acceptInvitation({
    invitationId: invitation.id,
    acceptedByUserId: params.userId,
    acceptedByUserName: params.name,
  });
  if (!result) {
    throw new TokenInvalidError('Invitation is no longer valid');
  }

  return result;
}

export async function listWorkspaceInvitations(params: {
  workspaceId: string;
  requesterUserId: string;
}): Promise<Invitation[]> {
  await requireWorkspaceMembership({
    workspaceId: params.workspaceId,
    userId: params.requesterUserId,
  });

  return listOpenInvitationsByWorkspace({workspaceId: params.workspaceId});
}

export async function revokeWorkspaceInvitation(params: {
  workspaceId: string;
  requesterUserId: string;
  invitationId: string;
}): Promise<void> {
  await requireWorkspaceMembership({
    workspaceId: params.workspaceId,
    userId: params.requesterUserId,
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
