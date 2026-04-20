import type {InvitationDto} from '@shipfox/api-workspaces-dto';
import type {Invitation} from '#core/entities/invitation.js';

export function toInvitationDto(invitation: Invitation): InvitationDto {
  return {
    id: invitation.id,
    workspace_id: invitation.workspaceId,
    email: invitation.email,
    expires_at: invitation.expiresAt.toISOString(),
    accepted_at: invitation.acceptedAt ? invitation.acceptedAt.toISOString() : null,
    invited_by_user_id: invitation.invitedByUserId,
    created_at: invitation.createdAt.toISOString(),
    updated_at: invitation.updatedAt.toISOString(),
  };
}
