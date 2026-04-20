import {and, eq, gt, isNull, lt, sql} from 'drizzle-orm';
import type {Invitation} from '#core/entities/invitation.js';
import type {Membership} from '#core/entities/membership.js';
import {OpenInvitationExistsError} from '#core/errors.js';
import {db} from './db.js';
import {invitations, toInvitation} from './schema/invitations.js';
import {memberships, toMembership} from './schema/memberships.js';

export interface CreateInvitationParams {
  workspaceId: string;
  email: string;
  hashedToken: string;
  expiresAt: Date;
  invitedByUserId: string;
}

export async function createInvitation(params: CreateInvitationParams): Promise<Invitation> {
  return await db().transaction(async (tx) => {
    await tx
      .delete(invitations)
      .where(
        and(
          eq(invitations.workspaceId, params.workspaceId),
          eq(invitations.email, params.email),
          isNull(invitations.acceptedAt),
          lt(invitations.expiresAt, sql`now()`),
        ),
      );

    const open = await tx
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.workspaceId, params.workspaceId),
          eq(invitations.email, params.email),
          isNull(invitations.acceptedAt),
        ),
      )
      .limit(1);

    if (open.length > 0) {
      throw new OpenInvitationExistsError(params.email);
    }

    const rows = await tx
      .insert(invitations)
      .values({
        workspaceId: params.workspaceId,
        email: params.email,
        hashedToken: params.hashedToken,
        expiresAt: params.expiresAt,
        invitedByUserId: params.invitedByUserId,
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error('Insert returned no rows');
    return toInvitation(row);
  });
}

export async function findInvitationByToken(params: {
  hashedToken: string;
}): Promise<Invitation | undefined> {
  const rows = await db()
    .select()
    .from(invitations)
    .where(eq(invitations.hashedToken, params.hashedToken))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toInvitation(row);
}

export async function findInvitationById(params: {id: string}): Promise<Invitation | undefined> {
  const rows = await db().select().from(invitations).where(eq(invitations.id, params.id)).limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toInvitation(row);
}

export async function listOpenInvitationsByWorkspace(params: {
  workspaceId: string;
}): Promise<Invitation[]> {
  const rows = await db()
    .select()
    .from(invitations)
    .where(and(eq(invitations.workspaceId, params.workspaceId), isNull(invitations.acceptedAt)));

  return rows.map(toInvitation);
}

export async function revokeInvitation(params: {invitationId: string}): Promise<void> {
  await db().delete(invitations).where(eq(invitations.id, params.invitationId));
}

export interface AcceptInvitationParams {
  invitationId: string;
  acceptedByUserId: string;
  acceptedByUserName?: string | null | undefined;
}

export interface AcceptInvitationResult {
  invitation: Invitation;
  membership: Membership;
  alreadyMember: boolean;
}

export async function acceptInvitation(
  params: AcceptInvitationParams,
): Promise<AcceptInvitationResult | undefined> {
  return await db().transaction(async (tx) => {
    const inv = await tx
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.id, params.invitationId),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, sql`now()`),
        ),
      )
      .limit(1);

    const invRow = inv[0];
    if (!invRow) return undefined;

    const existing = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, params.acceptedByUserId),
          eq(memberships.workspaceId, invRow.workspaceId),
        ),
      )
      .limit(1);

    let membership: Membership;
    let alreadyMember = false;
    const existingRow = existing[0];

    if (existingRow) {
      alreadyMember = true;
      membership = toMembership(existingRow);
    } else {
      const created = await tx
        .insert(memberships)
        .values({
          userId: params.acceptedByUserId,
          userEmail: invRow.email,
          userName: params.acceptedByUserName ?? null,
          workspaceId: invRow.workspaceId,
        })
        .returning();
      const createdRow = created[0];
      if (!createdRow) throw new Error('Insert returned no rows');
      membership = toMembership(createdRow);
    }

    const updated = await tx
      .update(invitations)
      .set({
        acceptedAt: sql`now()`,
        acceptedByUserId: params.acceptedByUserId,
        updatedAt: sql`now()`,
      })
      .where(eq(invitations.id, params.invitationId))
      .returning();

    const updatedRow = updated[0];
    if (!updatedRow) throw new Error('Update returned no rows');

    return {invitation: toInvitation(updatedRow), membership, alreadyMember};
  });
}
