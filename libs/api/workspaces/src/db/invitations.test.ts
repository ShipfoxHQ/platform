import {hashOpaqueToken} from '@shipfox/node-tokens';
import {eq, sql} from 'drizzle-orm';
import {OpenInvitationExistsError} from '#core/errors.js';
import {db} from './db.js';
import {
  acceptInvitation,
  createInvitation,
  findInvitationByToken,
  listOpenInvitationsByWorkspace,
  revokeInvitation,
} from './invitations.js';
import {invitations} from './schema/invitations.js';
import {createWorkspace} from './workspaces.js';

function emailFor(suffix: string): string {
  return `${suffix}-${crypto.randomUUID()}@example.com`;
}

async function createUser(params: {email: string; hashedPassword?: string; name?: string}) {
  await Promise.resolve();
  return {userId: crypto.randomUUID(), email: params.email, name: null};
}

describe('invitations db', () => {
  test('creates an invitation', async () => {
    const inviter = await createUser({email: emailFor('inviter'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});

    const invitation = await createInvitation({
      workspaceId: workspace.id,
      email: emailFor('guest'),
      hashedToken: hashOpaqueToken('inv-1'),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
    });

    expect(invitation.workspaceId).toBe(workspace.id);
    expect(invitation.acceptedAt).toBeNull();
  });

  test('rejects when an unexpired open invite already exists', async () => {
    const inviter = await createUser({email: emailFor('inviter'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const guest = emailFor('guest');
    await createInvitation({
      workspaceId: workspace.id,
      email: guest,
      hashedToken: hashOpaqueToken('first'),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
    });

    await expect(
      createInvitation({
        workspaceId: workspace.id,
        email: guest,
        hashedToken: hashOpaqueToken('second'),
        expiresAt: new Date(Date.now() + 86_400_000),
        invitedByUserId: inviter.userId,
      }),
    ).rejects.toBeInstanceOf(OpenInvitationExistsError);
  });

  test('on create, expired invites for same (workspace, email) are deleted first', async () => {
    const inviter = await createUser({email: emailFor('inviter'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const guest = emailFor('guest');
    const expiredToken = hashOpaqueToken('expired-inv');
    await db().insert(invitations).values({
      workspaceId: workspace.id,
      email: guest,
      hashedToken: expiredToken,
      expiresAt: sql`now() - interval '1 day'`,
      invitedByUserId: inviter.userId,
    });

    const fresh = await createInvitation({
      workspaceId: workspace.id,
      email: guest,
      hashedToken: hashOpaqueToken('fresh-inv'),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
    });

    expect(fresh.id).toBeDefined();
    const stillThere = await db()
      .select()
      .from(invitations)
      .where(eq(invitations.hashedToken, expiredToken));
    expect(stillThere).toHaveLength(0);
  });

  test('acceptInvitation creates membership + marks accepted (transactional)', async () => {
    const inviter = await createUser({email: emailFor('inviter'), hashedPassword: 'h'});
    const accepter = await createUser({email: emailFor('accepter'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const inv = await createInvitation({
      workspaceId: workspace.id,
      email: accepter.email,
      hashedToken: hashOpaqueToken('inv-accept'),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
    });

    const result = await acceptInvitation({
      invitationId: inv.id,
      acceptedByUserId: accepter.userId,
    });

    expect(result?.invitation.acceptedAt).toBeInstanceOf(Date);
    expect(result?.invitation.acceptedByUserId).toBe(accepter.userId);
    expect(result?.membership.userId).toBe(accepter.userId);
    expect(result?.alreadyMember).toBe(false);
  });

  test('acceptInvitation is idempotent when caller is already a member', async () => {
    const inviter = await createUser({email: emailFor('inviter'), hashedPassword: 'h'});
    const member = await createUser({email: emailFor('member'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const {createMembership} = await import('./memberships.js');
    const existing = await createMembership({userId: member.userId, workspaceId: workspace.id});
    const inv = await createInvitation({
      workspaceId: workspace.id,
      email: member.email,
      hashedToken: hashOpaqueToken('inv-idem'),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
    });

    const result = await acceptInvitation({invitationId: inv.id, acceptedByUserId: member.userId});

    expect(result?.alreadyMember).toBe(true);
    expect(result?.membership.id).toBe(existing.id);
  });

  test('acceptInvitation returns undefined when expired', async () => {
    const inviter = await createUser({email: emailFor('inviter'), hashedPassword: 'h'});
    const accepter = await createUser({email: emailFor('accepter'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const expiredToken = hashOpaqueToken('expired-accept');
    const [inserted] = await db()
      .insert(invitations)
      .values({
        workspaceId: workspace.id,
        email: accepter.email,
        hashedToken: expiredToken,
        expiresAt: sql`now() - interval '1 second'`,
        invitedByUserId: inviter.userId,
      })
      .returning();
    if (!inserted) throw new Error('insert failed');

    const result = await acceptInvitation({
      invitationId: inserted.id,
      acceptedByUserId: accepter.userId,
    });

    expect(result).toBeUndefined();
  });

  test('lists only open invitations and revokes them', async () => {
    const inviter = await createUser({email: emailFor('inviter'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const inv = await createInvitation({
      workspaceId: workspace.id,
      email: emailFor('guest'),
      hashedToken: hashOpaqueToken('inv-list'),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
    });

    const before = await listOpenInvitationsByWorkspace({workspaceId: workspace.id});
    await revokeInvitation({invitationId: inv.id});
    const after = await listOpenInvitationsByWorkspace({workspaceId: workspace.id});

    expect(before.some((i) => i.id === inv.id)).toBe(true);
    expect(after.some((i) => i.id === inv.id)).toBe(false);
  });

  test('findInvitationByToken returns matching row', async () => {
    const inviter = await createUser({email: emailFor('inviter'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const tokenHash = hashOpaqueToken('inv-find');
    const inv = await createInvitation({
      workspaceId: workspace.id,
      email: emailFor('guest'),
      hashedToken: tokenHash,
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
    });

    const found = await findInvitationByToken({hashedToken: tokenHash});

    expect(found?.id).toBe(inv.id);
  });
});
