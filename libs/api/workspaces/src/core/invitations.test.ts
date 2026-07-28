import {WORKSPACES_INVITATION_SEND_REQUESTED} from '@shipfox/api-workspaces-dto';
import type {Mailer, MailMessage} from '@shipfox/node-mailer';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {and, desc, eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {findInvitationByToken, revokeInvitation} from '#db/invitations.js';
import {createMembership} from '#db/memberships.js';
import {workspacesOutbox} from '#db/schema/outbox.js';
import {userFactory, workspaceFactory} from '#test/index.js';
import {
  InvitationEmailMismatchError,
  OpenInvitationExistsError,
  TokenAlreadyUsedError,
} from './errors.js';
import {
  acceptWorkspaceInvitation,
  createWorkspaceInvitation,
  previewInvitation,
} from './invitations.js';

const testConfig = vi.hoisted(
  (): {
    captured: MailMessage[];
    mailer: Mailer;
    clientBaseUrl: string;
  } => {
    const captured: MailMessage[] = [];
    const mailer: Mailer = {
      send: (message) => {
        captured.push(message);
        return Promise.resolve();
      },
    };
    return {
      captured,
      mailer,
      clientBaseUrl: 'https://app.example.test',
    };
  },
);

vi.mock('#config.js', () => ({
  config: {
    WORKSPACE_JWT_SECRET: 'invitation-core-test-secret',
    WORKSPACE_JWT_EXPIRES_IN: '7d',
    CLIENT_BASE_URL: testConfig.clientBaseUrl,
  },
  mailer: testConfig.mailer,
}));

const TOKEN_RE = /token=([\w\-_=]+)/;

function extractToken(link: string | undefined): string {
  const match = link?.match(TOKEN_RE);
  if (!match?.[1]) {
    throw new Error('Expected link to contain a token');
  }
  return match[1];
}

async function invitationEventsTo(email: string) {
  return await db()
    .select()
    .from(workspacesOutbox)
    .where(
      and(
        eq(workspacesOutbox.eventType, WORKSPACES_INVITATION_SEND_REQUESTED),
        sql`${workspacesOutbox.payload}->>'email' = ${email}`,
      ),
    )
    .orderBy(desc(workspacesOutbox.createdAt));
}

async function latestInvitationPayload(email: string) {
  const row = (await invitationEventsTo(email))[0];
  if (!row) throw new Error(`No invitation outbox event for ${email}`);
  return row.payload as {
    email: string;
    workspaceName: string;
    inviterName: string;
    inviteLink: string;
  };
}

describe('invitations core', () => {
  let captured: MailMessage[];

  beforeEach(() => {
    captured = testConfig.captured;
    captured.length = 0;
  });

  test('createWorkspaceInvitation creates an invitation and queues an email', async () => {
    const inviter = userFactory.build();
    const workspace = await workspaceFactory.create();
    await createMembership({
      userId: inviter.userId,
      userEmail: inviter.email,
      userName: inviter.name,
      workspaceId: workspace.id,
    });
    const email = `invitee-${crypto.randomUUID()}@example.com`;

    const invitation = await createWorkspaceInvitation({
      workspaceId: workspace.id,
      email,
      invitedByUserId: inviter.userId,
      invitedByMemberships: [{workspaceId: workspace.id, role: 'admin', workspaceStatus: 'active'}],
    });

    expect(invitation.email).toBe(email);
    expect(captured).toHaveLength(0);
    expect(await invitationEventsTo(email)).toHaveLength(1);
  });

  test('createWorkspaceInvitation queues the workspace name and inviter', async () => {
    const inviter = userFactory.build();
    const workspace = await workspaceFactory.create();
    await createMembership({
      userId: inviter.userId,
      userEmail: inviter.email,
      userName: inviter.name,
      workspaceId: workspace.id,
    });
    const email = `invitee-${crypto.randomUUID()}@example.com`;

    await createWorkspaceInvitation({
      workspaceId: workspace.id,
      email,
      invitedByUserId: inviter.userId,
      invitedByDisplay: 'Dana Scully',
      invitedByMemberships: [{workspaceId: workspace.id, role: 'admin', workspaceStatus: 'active'}],
    });

    const payload = await latestInvitationPayload(email);
    expect(captured).toHaveLength(0);
    expect(payload).toMatchObject({
      email,
      workspaceName: workspace.name,
      inviterName: 'Dana Scully',
    });
    expect(payload.inviteLink).toContain(`${testConfig.clientBaseUrl}/invitations/accept?token=`);
  });

  test('createWorkspaceInvitation queues the teammate fallback when no inviter display is given', async () => {
    const inviter = userFactory.build();
    const workspace = await workspaceFactory.create();
    await createMembership({
      userId: inviter.userId,
      userEmail: inviter.email,
      userName: inviter.name,
      workspaceId: workspace.id,
    });
    const email = `invitee-${crypto.randomUUID()}@example.com`;

    await createWorkspaceInvitation({
      workspaceId: workspace.id,
      email,
      invitedByUserId: inviter.userId,
      invitedByMemberships: [{workspaceId: workspace.id, role: 'admin', workspaceStatus: 'active'}],
    });

    const payload = await latestInvitationPayload(email);
    expect(captured).toHaveLength(0);
    expect(payload.inviterName).toBe('A teammate');
  });

  test('createWorkspaceInvitation queues fallbacks for blank display values', async () => {
    const inviter = userFactory.build();
    const workspace = await workspaceFactory.create({name: '   '});
    await createMembership({
      userId: inviter.userId,
      userEmail: inviter.email,
      userName: inviter.name,
      workspaceId: workspace.id,
    });
    const email = `invitee-${crypto.randomUUID()}@example.com`;

    await createWorkspaceInvitation({
      workspaceId: workspace.id,
      email,
      invitedByUserId: inviter.userId,
      invitedByDisplay: '   ',
      invitedByMemberships: [{workspaceId: workspace.id, role: 'admin', workspaceStatus: 'active'}],
    });

    const payload = await latestInvitationPayload(email);
    expect(captured).toHaveLength(0);
    expect(payload.workspaceName).toBe('your workspace');
    expect(payload.inviterName).toBe('A teammate');
  });

  test('createWorkspaceInvitation rejects duplicate open invitations', async () => {
    const inviter = userFactory.build();
    const workspace = await workspaceFactory.create();
    await createMembership({
      userId: inviter.userId,
      userEmail: inviter.email,
      userName: inviter.name,
      workspaceId: workspace.id,
    });
    const email = `duplicate-${crypto.randomUUID()}@example.com`;
    await createWorkspaceInvitation({
      workspaceId: workspace.id,
      email,
      invitedByUserId: inviter.userId,
      invitedByMemberships: [{workspaceId: workspace.id, role: 'admin', workspaceStatus: 'active'}],
    });

    const promise = createWorkspaceInvitation({
      workspaceId: workspace.id,
      email,
      invitedByUserId: inviter.userId,
      invitedByMemberships: [{workspaceId: workspace.id, role: 'admin', workspaceStatus: 'active'}],
    });

    await expect(promise).rejects.toBeInstanceOf(OpenInvitationExistsError);
    expect(captured).toHaveLength(0);
    expect(await invitationEventsTo(email)).toHaveLength(1);
  });

  test('acceptWorkspaceInvitation accepts once and enforces the invited email', async () => {
    const inviter = userFactory.build();
    const invitee = userFactory.build();
    const workspace = await workspaceFactory.create();
    await createMembership({
      userId: inviter.userId,
      userEmail: inviter.email,
      userName: inviter.name,
      workspaceId: workspace.id,
    });
    await createWorkspaceInvitation({
      workspaceId: workspace.id,
      email: invitee.email,
      invitedByUserId: inviter.userId,
      invitedByMemberships: [{workspaceId: workspace.id, role: 'admin', workspaceStatus: 'active'}],
    });
    const token = extractToken((await latestInvitationPayload(invitee.email)).inviteLink);

    const wrongEmail = acceptWorkspaceInvitation({
      token,
      userId: invitee.userId,
      email: `wrong-${crypto.randomUUID()}@example.com`,
    });
    await expect(wrongEmail).rejects.toBeInstanceOf(InvitationEmailMismatchError);

    const result = await acceptWorkspaceInvitation({
      token,
      userId: invitee.userId,
      email: `  ${invitee.email.toUpperCase()}  `,
    });
    expect(result.membership.workspaceId).toBe(workspace.id);

    const reused = acceptWorkspaceInvitation({token, userId: invitee.userId, email: invitee.email});
    await expect(reused).rejects.toBeInstanceOf(TokenAlreadyUsedError);
  });

  test('previewInvitation treats a revoked invitation as invalid', async () => {
    const inviter = userFactory.build();
    const workspace = await workspaceFactory.create();
    await createMembership({
      userId: inviter.userId,
      userEmail: inviter.email,
      userName: inviter.name,
      workspaceId: workspace.id,
    });
    const email = `revoked-${crypto.randomUUID()}@example.com`;
    await createWorkspaceInvitation({
      workspaceId: workspace.id,
      email,
      invitedByUserId: inviter.userId,
      invitedByMemberships: [{workspaceId: workspace.id, role: 'admin', workspaceStatus: 'active'}],
    });
    const payload = await latestInvitationPayload(email);
    const token = extractToken(payload.inviteLink);
    const invitation = await findInvitationByToken({hashedToken: hashOpaqueToken(token)});
    if (!invitation) throw new Error('Expected stored invitation');
    await revokeInvitation({invitationId: invitation.id});

    const result = await previewInvitation({token});

    expect(result).toEqual({status: 'invalid'});
  });
});
