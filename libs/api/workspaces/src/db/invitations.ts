import {
  WORKSPACES_INVITATION_SEND_REQUESTED,
  WORKSPACES_MEMBER_INVITED,
  WORKSPACES_MEMBER_JOINED,
  type WorkspacesEventMap,
} from '@shipfox/api-workspaces-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, eq, gt, isNull, lt, sql} from 'drizzle-orm';
import type {Invitation} from '#core/entities/invitation.js';
import type {Membership} from '#core/entities/membership.js';
import {OpenInvitationExistsError} from '#core/errors.js';
import {
  recordWorkspaceInvitationAccepted,
  recordWorkspaceInvitationCreated,
  recordWorkspaceMembershipChanged,
} from '#metrics/instance.js';
import {db} from './db.js';
import {findMembership, membershipValues} from './memberships.js';
import {invitations, toInvitation} from './schema/invitations.js';
import {memberships, toMembership} from './schema/memberships.js';
import {workspacesOutbox} from './schema/outbox.js';

interface CreateInvitationBaseParams {
  workspaceId: string;
  email: string;
  hashedToken: string;
  expiresAt: Date;
  invitedByUserId: string;
  invitedByDisplay?: string | null;
}

export type CreateInvitationParams = CreateInvitationBaseParams &
  (
    | {
        sendEmail: {
          workspaceName: string;
          inviterName: string;
          inviteLink: string;
        };
        skipEmail?: never;
      }
    | {sendEmail?: never; skipEmail: true}
  );

export async function createInvitation(params: CreateInvitationParams): Promise<Invitation> {
  const result = await db().transaction(async (tx) => {
    await tx
      .delete(invitations)
      .where(
        and(
          eq(invitations.workspaceId, params.workspaceId),
          eq(invitations.email, params.email),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
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
          isNull(invitations.revokedAt),
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
        invitedByDisplay: params.invitedByDisplay ?? null,
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error('Insert returned no rows');
    await writeOutboxEvent<WorkspacesEventMap>(tx, workspacesOutbox, {
      type: WORKSPACES_MEMBER_INVITED,
      payload: {
        workspaceId: params.workspaceId,
        invitedEmail: params.email,
        inviterUserId: params.invitedByUserId,
        role: 'admin',
      },
    });
    if (params.sendEmail) {
      await writeOutboxEvent<WorkspacesEventMap>(tx, workspacesOutbox, {
        type: WORKSPACES_INVITATION_SEND_REQUESTED,
        payload: {
          email: params.email,
          ...params.sendEmail,
        },
      });
    }
    return {
      invitation: toInvitation(row),
      emailRequested: params.sendEmail ? ('requested' as const) : ('skipped' as const),
    };
  });

  recordWorkspaceInvitationCreated(result.emailRequested);
  return result.invitation;
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
    .where(
      and(
        eq(invitations.workspaceId, params.workspaceId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, sql`now()`),
      ),
    );

  return rows.map(toInvitation);
}

export async function revokeInvitation(params: {invitationId: string}): Promise<void> {
  await db()
    .update(invitations)
    .set({revokedAt: sql`now()`, updatedAt: sql`now()`})
    .where(and(eq(invitations.id, params.invitationId), isNull(invitations.acceptedAt)));
}

export type ReconcileInvitationAcceptanceResult =
  | {status: 'accepted'; invitation: Invitation; membership: Membership; alreadyMember: boolean}
  | {status: 'already_accepted'; invitation: Invitation; membership: Membership}
  | {status: 'invalid' | 'expired' | 'revoked' | 'consumed_by_another_user' | 'email_mismatch'};

type WorkspacesTx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];
type ReconcileInvitationAcceptanceParams = {
  invitationId: string;
  acceptedByUserId: string;
  email: string;
  acceptedByUserName?: string | null | undefined;
};

export async function reconcileInvitationAcceptance(
  params: ReconcileInvitationAcceptanceParams,
): Promise<ReconcileInvitationAcceptanceResult> {
  const result = await db().transaction((tx) => reconcileInvitationInTransaction(tx, params));

  if (result.status === 'accepted') {
    if (!result.alreadyMember) recordWorkspaceMembershipChanged('added');
    recordWorkspaceInvitationAccepted(result.alreadyMember ? 'already_member' : 'added');
  }
  return result;
}

async function reconcileInvitationInTransaction(
  tx: WorkspacesTx,
  params: ReconcileInvitationAcceptanceParams,
): Promise<ReconcileInvitationAcceptanceResult> {
  const rows = await tx
    .select()
    .from(invitations)
    .where(eq(invitations.id, params.invitationId))
    .limit(1)
    .for('update');
  const row = rows[0];
  if (!row) return {status: 'invalid'} as const;

  const invitation = toInvitation(row);
  if (invitation.acceptedAt !== null) {
    return reconcileAlreadyAcceptedInvitation(tx, params, invitation);
  }
  const invalidStatus = invitationAcceptanceInvalidStatus(invitation, params.email);
  if (invalidStatus) return {status: invalidStatus};

  const {membership, alreadyMember} = await ensureInvitationMembership(tx, params, invitation);

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
  return {
    status: 'accepted',
    invitation: toInvitation(updatedRow),
    membership,
    alreadyMember,
  } as const;
}

async function reconcileAlreadyAcceptedInvitation(
  tx: WorkspacesTx,
  params: ReconcileInvitationAcceptanceParams,
  invitation: Invitation,
): Promise<ReconcileInvitationAcceptanceResult> {
  if (invitation.acceptedByUserId !== params.acceptedByUserId) {
    return {status: 'consumed_by_another_user'};
  }
  const membership = await findMembership(
    {userId: params.acceptedByUserId, workspaceId: invitation.workspaceId},
    {tx},
  );
  if (!membership) throw new Error('Accepted invitation has no membership');
  return {status: 'already_accepted', invitation, membership};
}

function invitationAcceptanceInvalidStatus(
  invitation: Invitation,
  email: string,
): 'expired' | 'revoked' | 'email_mismatch' | undefined {
  if (invitation.revokedAt !== null) return 'revoked';
  if (invitation.expiresAt.getTime() <= Date.now()) return 'expired';
  if (invitation.email !== email) return 'email_mismatch';
  return undefined;
}

async function ensureInvitationMembership(
  tx: WorkspacesTx,
  params: ReconcileInvitationAcceptanceParams,
  invitation: Invitation,
): Promise<{membership: Membership; alreadyMember: boolean}> {
  const existing = await findMembership(
    {userId: params.acceptedByUserId, workspaceId: invitation.workspaceId},
    {tx},
  );
  if (existing) return {membership: existing, alreadyMember: true};
  const created = await tx
    .insert(memberships)
    .values(
      membershipValues({
        userId: params.acceptedByUserId,
        userEmail: invitation.email,
        userName: params.acceptedByUserName ?? null,
        workspaceId: invitation.workspaceId,
      }),
    )
    .returning();
  const createdRow = created[0];
  if (!createdRow) throw new Error('Insert returned no rows');
  const membership = toMembership(createdRow);
  await writeOutboxEvent<WorkspacesEventMap>(tx, workspacesOutbox, {
    type: WORKSPACES_MEMBER_JOINED,
    payload: {
      workspaceId: invitation.workspaceId,
      userId: params.acceptedByUserId,
      email: invitation.email,
      viaInvitation: true,
    },
  });
  return {membership, alreadyMember: false};
}
