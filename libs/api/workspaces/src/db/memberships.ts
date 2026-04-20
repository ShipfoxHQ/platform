import {and, eq, sql} from 'drizzle-orm';
import type {Membership} from '#core/entities/membership.js';
import {LastMemberError} from '#core/errors.js';
import {db} from './db.js';
import {memberships, toMembership} from './schema/memberships.js';
import {workspaces} from './schema/workspaces.js';

export interface CreateMembershipParams {
  userId: string;
  userEmail?: string | undefined;
  userName?: string | null | undefined;
  workspaceId: string;
}

export async function createMembership(params: CreateMembershipParams): Promise<Membership> {
  const rows = await db()
    .insert(memberships)
    .values({
      userId: params.userId,
      userEmail: params.userEmail ?? `user-${params.userId}@example.local`,
      userName: params.userName ?? null,
      workspaceId: params.workspaceId,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toMembership(row);
}

export interface MembershipWithWorkspace extends Membership {
  workspaceName: string;
}

export async function listMembershipsByUser(params: {
  userId: string;
}): Promise<MembershipWithWorkspace[]> {
  const rows = await db()
    .select({
      membership: memberships,
      workspaceName: workspaces.name,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, params.userId));

  return rows.map((row) => ({...toMembership(row.membership), workspaceName: row.workspaceName}));
}

export interface MembershipWithUser extends Membership {
  userEmail: string;
  userName: string | null;
}

export async function listMembershipsByWorkspace(params: {
  workspaceId: string;
}): Promise<MembershipWithUser[]> {
  const rows = await db()
    .select()
    .from(memberships)
    .where(eq(memberships.workspaceId, params.workspaceId));

  return rows.map(toMembership);
}

export async function findMembership(params: {
  userId: string;
  workspaceId: string;
}): Promise<Membership | undefined> {
  const rows = await db()
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
  await db().transaction(async (tx) => {
    const countResult = await tx
      .select({count: sql<number>`count(*)::int`})
      .from(memberships)
      .where(eq(memberships.workspaceId, params.workspaceId));
    const total = countResult[0]?.count ?? 0;
    if (total <= 1) {
      throw new LastMemberError(params.workspaceId);
    }

    await tx
      .delete(memberships)
      .where(
        and(eq(memberships.userId, params.userId), eq(memberships.workspaceId, params.workspaceId)),
      );
  });
}
