import type {UserContextMembership} from '@shipfox/api-auth-context';
import {
  WORKSPACES_WORKSPACE_CREATED,
  type WorkspaceRole,
  type WorkspacesEventMap,
} from '@shipfox/api-workspaces-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
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
import {workspacesOutbox} from '#db/schema/outbox.js';
import {toWorkspace, workspaces} from '#db/schema/workspaces.js';
import {getWorkspaceById} from '#db/workspaces.js';
import type {Workspace} from './entities/workspace.js';
import {
  MembershipNotFoundError,
  MembershipRequiredError,
  SelfRemovalNotAllowedError,
  WorkspaceInactiveError,
  WorkspaceNotFoundError,
} from './errors.js';

export interface RequireWorkspaceMembershipParams {
  workspaceId: string;
  userId: string;
  memberships: ReadonlyArray<UserContextMembership>;
}

export interface RequireWorkspaceMembershipResult {
  workspace: Workspace;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

export async function requireWorkspaceMembership(
  params: RequireWorkspaceMembershipParams,
): Promise<RequireWorkspaceMembershipResult> {
  const membership = params.memberships.find((m) => m.workspaceId === params.workspaceId);
  if (!membership) {
    throw new MembershipRequiredError(params.workspaceId);
  }

  const workspace = await getWorkspaceById(params.workspaceId);
  if (!workspace) {
    throw new WorkspaceNotFoundError(params.workspaceId);
  }
  if (workspace.status !== 'active') {
    throw new WorkspaceInactiveError(params.workspaceId);
  }

  return {workspace, workspaceId: workspace.id, userId: params.userId, role: membership.role};
}

export async function createWorkspaceForUser(params: {
  name: string;
  userId: string;
  userEmail?: string | undefined;
  userName?: string | null | undefined;
}): Promise<Workspace> {
  return await db().transaction(async (tx) => {
    const [workspaceRow] = await tx
      .insert(workspaces)
      .values({name: params.name, createdBy: params.userId})
      .returning();
    if (!workspaceRow) throw new Error('Insert returned no rows');
    await tx.insert(memberships).values({
      userId: params.userId,
      userEmail: params.userEmail ?? `user-${params.userId}@example.local`,
      userName: params.userName ?? null,
      workspaceId: workspaceRow.id,
    });
    const workspace = toWorkspace(workspaceRow);

    await writeOutboxEvent<WorkspacesEventMap>(tx, workspacesOutbox, {
      type: WORKSPACES_WORKSPACE_CREATED,
      payload: {
        workspaceId: workspace.id,
        name: workspace.name,
        creatorUserId: params.userId,
      },
    });

    return workspace;
  });
}

export async function getWorkspace(params: {workspaceId: string}): Promise<Workspace> {
  const workspace = await getWorkspaceById(params.workspaceId);
  if (!workspace) {
    throw new WorkspaceNotFoundError(params.workspaceId);
  }

  return workspace;
}

export async function getWorkspaceCreator(params: {workspaceId: string}): Promise<string | null> {
  const workspace = await getWorkspace(params);
  return workspace.createdBy;
}

export async function getWorkspaceOperatingState(params: {
  workspaceId: string;
}): Promise<Workspace['status']> {
  const workspace = await getWorkspace(params);
  return workspace.status;
}

export async function listUserWorkspaceMemberships(params: {
  userId: string;
}): Promise<MembershipWithWorkspace[]> {
  return await listMembershipsByUser({userId: params.userId});
}

export async function listWorkspaceMembers(params: {
  workspaceId: string;
  requesterUserId: string;
  requesterMemberships: ReadonlyArray<UserContextMembership>;
}): Promise<MembershipWithUser[]> {
  await requireWorkspaceMembership({
    workspaceId: params.workspaceId,
    userId: params.requesterUserId,
    memberships: params.requesterMemberships,
  });

  return listMembershipsByWorkspace({workspaceId: params.workspaceId});
}

export async function removeWorkspaceMember(params: {
  workspaceId: string;
  requesterUserId: string;
  requesterMemberships: ReadonlyArray<UserContextMembership>;
  userId: string;
}): Promise<void> {
  await requireWorkspaceMembership({
    workspaceId: params.workspaceId,
    userId: params.requesterUserId,
    memberships: params.requesterMemberships,
  });

  if (params.userId === params.requesterUserId) {
    throw new SelfRemovalNotAllowedError();
  }

  const target = await findMembership({userId: params.userId, workspaceId: params.workspaceId});
  if (!target) {
    throw new MembershipNotFoundError(params.userId, params.workspaceId);
  }

  await removeMembership({userId: params.userId, workspaceId: params.workspaceId});
}
