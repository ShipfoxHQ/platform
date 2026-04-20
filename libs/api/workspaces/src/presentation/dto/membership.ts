import type {MembershipWithUserDto, MembershipWithWorkspaceDto} from '@shipfox/api-workspaces-dto';
import type {MembershipWithUser, MembershipWithWorkspace} from '#db/memberships.js';

export function toMembershipWithWorkspaceDto(
  membership: MembershipWithWorkspace,
): MembershipWithWorkspaceDto {
  return {
    id: membership.id,
    user_id: membership.userId,
    workspace_id: membership.workspaceId,
    workspace_name: membership.workspaceName,
    created_at: membership.createdAt.toISOString(),
    updated_at: membership.updatedAt.toISOString(),
  };
}

export function toMembershipWithUserDto(membership: MembershipWithUser): MembershipWithUserDto {
  return {
    id: membership.id,
    user_id: membership.userId,
    workspace_id: membership.workspaceId,
    user_email: membership.userEmail,
    user_name: membership.userName,
    created_at: membership.createdAt.toISOString(),
    updated_at: membership.updatedAt.toISOString(),
  };
}
