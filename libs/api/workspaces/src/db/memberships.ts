import {and, eq, sql} from 'drizzle-orm';
import type {Membership} from '#core/entities/membership.js';
import type {Workspace} from '#core/entities/workspace.js';
import {LastMemberError} from '#core/errors.js';
import {recordWorkspaceMembershipChanged} from '#metrics/instance.js';
import {db} from './db.js';
import {memberships, toMembership} from './schema/memberships.js';
import {workspaces} from './schema/workspaces.js';

export interface CreateMembershipParams {
  userId: string;
  userEmail?: string | undefined;
  userName?: string | null | undefined;
  workspaceId: string;
}

export interface EnsureMembershipParams {
  userId: string;
  userEmail: string;
  userName: string | null;
  workspaceId: string;
}

export function membershipValues(params: CreateMembershipParams) {
  return {
    userId: params.userId,
    userEmail: params.userEmail ?? `user-${params.userId}@example.local`,
    userName: params.userName ?? null,
    workspaceId: params.workspaceId,
  };
}

export async function createMembership(params: CreateMembershipParams): Promise<Membership> {
  const rows = await db().insert(memberships).values(membershipValues(params)).returning();

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  recordWorkspaceMembershipChanged('added');
  return toMembership(row);
}

export async function ensureMembership(params: EnsureMembershipParams): Promise<Membership> {
  const rows = await db()
    .insert(memberships)
    .values(membershipValues(params))
    .onConflictDoNothing({target: [memberships.userId, memberships.workspaceId]})
    .returning();

  const row = rows[0];
  if (row) {
    recordWorkspaceMembershipChanged('added');
    return toMembership(row);
  }

  const existing = await findMembership(params);
  if (existing) return existing;
  throw new Error('Membership conflict returned no membership');
}

export interface MembershipWithWorkspace extends Membership {
  workspaceName: string;
  workspaceSlug: string;
  workspaceStatus: Workspace['status'];
}

export async function listMembershipsByUser(params: {
  userId: string;
}): Promise<MembershipWithWorkspace[]> {
  const rows = await db()
    .select({
      membership: memberships,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      workspaceStatus: workspaces.status,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, params.userId))
    .orderBy(workspaces.name);

  return rows.map((row) => ({
    ...toMembership(row.membership),
    workspaceName: row.workspaceName,
    workspaceSlug: row.workspaceSlug,
    workspaceStatus: row.workspaceStatus,
  }));
}

export interface MembershipWithUser extends Membership {
  userEmail: string;
  userName: string | null;
}

type WorkspaceDatabase = ReturnType<typeof db>;
type WorkspaceTransaction = Parameters<Parameters<WorkspaceDatabase['transaction']>[0]>[0];

export async function listMembershipsByWorkspace(params: {
  workspaceId: string;
}): Promise<MembershipWithUser[]> {
  const rows = await db()
    .select()
    .from(memberships)
    .where(eq(memberships.workspaceId, params.workspaceId));

  return rows.map(toMembership);
}

export async function findMembership(
  params: {userId: string; workspaceId: string},
  options: {tx?: WorkspaceDatabase | WorkspaceTransaction | undefined} = {},
): Promise<Membership | undefined> {
  const executor = options.tx ?? db();
  const rows = await executor
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.userId, params.userId), eq(memberships.workspaceId, params.workspaceId)),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toMembership(row);
}

export interface RemoveMembershipParams {
  userId: string;
  workspaceId: string;
}

export async function removeMembership(params: RemoveMembershipParams): Promise<void> {
  const removed = await db().transaction(async (tx) => {
    const countResult = await tx
      .select({count: sql<number>`count(*)::int`})
      .from(memberships)
      .where(eq(memberships.workspaceId, params.workspaceId));
    const total = countResult[0]?.count ?? 0;
    if (total <= 1) {
      throw new LastMemberError(params.workspaceId);
    }

    const deleted = await tx
      .delete(memberships)
      .where(
        and(eq(memberships.userId, params.userId), eq(memberships.workspaceId, params.workspaceId)),
      )
      .returning({id: memberships.id});

    return deleted.length > 0;
  });

  if (removed) recordWorkspaceMembershipChanged('removed');
}
