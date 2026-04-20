import {db} from '#db/db.js';
import {
  findMembership,
  listMembershipsByUser,
  listMembershipsByWorkspace,
  type MembershipWithUser,
  type MembershipWithWorkspace,
  removeMembership,
} from '#db/memberships.js';
import {memberships} from '#db/schema/memberships.js';
import {toWorkspace, workspaces} from '#db/schema/workspaces.js';
import {getWorkspaceById} from '#db/workspaces.js';
import type {Workspace} from './entities/workspace.js';
import {
  MembershipNotFoundError,
  MembershipRequiredError,
  WorkspaceNotFoundError,
} from './errors.js';

export interface RequireWorkspaceMembershipParams {
  workspaceId: string;
  userId: string;
}

export interface RequireWorkspaceMembershipResult {
  workspace: Workspace;
  workspaceId: string;
  userId: string;
}

export async function requireWorkspaceMembership(
  params: RequireWorkspaceMembershipParams,
): Promise<RequireWorkspaceMembershipResult> {
  const workspace = await getWorkspaceById(params.workspaceId);
  if (!workspace) {
    throw new WorkspaceNotFoundError(params.workspaceId);
  }

  const membership = await findMembership({userId: params.userId, workspaceId: params.workspaceId});
  if (!membership) {
    throw new MembershipRequiredError(params.workspaceId);
  }

  return {workspace, workspaceId: workspace.id, userId: params.userId};
}

export async function createWorkspaceForUser(params: {
  name: string;
  userId: string;
  userEmail?: string | undefined;
  userName?: string | null | undefined;
}): Promise<Workspace> {
  return await db().transaction(async (tx) => {
    const [workspaceRow] = await tx.insert(workspaces).values({name: params.name}).returning();
    if (!workspaceRow) throw new Error('Insert returned no rows');
    await tx.insert(memberships).values({
      userId: params.userId,
      userEmail: params.userEmail ?? `user-${params.userId}@example.local`,
      userName: params.userName ?? null,
      workspaceId: workspaceRow.id,
    });
    return toWorkspace(workspaceRow);
  });
}

export async function getWorkspace(params: {workspaceId: string}): Promise<Workspace> {
  const workspace = await getWorkspaceById(params.workspaceId);
  if (!workspace) {
    throw new WorkspaceNotFoundError(params.workspaceId);
  }

  return workspace;
}

export async function listUserWorkspaceMemberships(params: {
  userId: string;
}): Promise<MembershipWithWorkspace[]> {
  return await listMembershipsByUser({userId: params.userId});
}

export async function listWorkspaceMembers(params: {
  workspaceId: string;
  requesterUserId: string;
}): Promise<MembershipWithUser[]> {
  await requireWorkspaceMembership({
    workspaceId: params.workspaceId,
    userId: params.requesterUserId,
  });

  return listMembershipsByWorkspace({workspaceId: params.workspaceId});
}

export async function removeWorkspaceMember(params: {
  workspaceId: string;
  requesterUserId: string;
  userId: string;
}): Promise<void> {
  await requireWorkspaceMembership({
    workspaceId: params.workspaceId,
    userId: params.requesterUserId,
  });

  const target = await findMembership({userId: params.userId, workspaceId: params.workspaceId});
  if (!target) {
    throw new MembershipNotFoundError(params.userId, params.workspaceId);
  }

  await removeMembership({userId: params.userId, workspaceId: params.workspaceId});
}
