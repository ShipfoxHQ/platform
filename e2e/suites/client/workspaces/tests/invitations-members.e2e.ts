import {randomUUID} from 'node:crypto';
import {stableScreenshot} from '@shipfox/e2e-kit/ui';
import {expect, test} from './test.js';

const PENDING_INVITATION_RE = /open invitation already exists/u;
const VISUAL_OWNER_EMAIL = 'owner@example.test';
const VISUAL_INVITEE_EMAIL = 'invitee@example.test';
const VISUAL_PENDING_EMAIL = 'pending-invitee@example.test';
const VISUAL_JOINED_DATE = 'May 1, 2026';
const VISUAL_EXPIRES_DATE = 'May 20, 2026';

function workspaceUrlRe(wid: string): RegExp {
  return new RegExp(`/workspaces/${wid}(/|$)`, 'u');
}

function textRe(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u');
}

test('accepts an invitation for an existing user outside the signup allowlist via login', async ({
  page,
  auth,
  invitationAccept,
  membersSettings,
  projects,
  workspaces,
}) => {
  test.setTimeout(60_000);

  const owner = await auth.createUser({name: 'Owner User'});
  const invitee = await auth.createUser({name: 'Invitee User'});
  const workspace = await workspaces.create({
    userId: owner.user.id,
    userEmail: owner.email,
    userName: owner.user.name,
    name: 'Invitation Flow Workspace',
  });
  const invitation = await workspaces.createInvitation({
    workspaceId: workspace.id,
    email: invitee.email,
    invitedByUserId: owner.user.id,
    invitedByDisplay: 'Owner User',
  });

  await invitationAccept.goto(invitation.raw_token);
  await expect(invitationAccept.heading('Invitation Flow Workspace')).toBeVisible();
  await expect(
    invitationAccept.message(`Invited by Owner User to join as ${invitee.email}.`),
  ).toBeVisible();
  await stableScreenshot(page, 'invitations/pending-unauth', {
    textReplacements: [
      [owner.email, VISUAL_OWNER_EMAIL],
      [invitee.email, VISUAL_INVITEE_EMAIL],
    ],
    hideToaster: true,
  });

  await invitationAccept.link('I already have an account').click();
  await expect(invitationAccept.heading('Join Invitation Flow Workspace')).toBeVisible();
  const emailInput = invitationAccept.field('Email');
  await expect(emailInput).toHaveValue(invitee.email);
  await expect(emailInput).toHaveJSProperty('readOnly', true);
  await expect(invitationAccept.message('Joining Invitation Flow Workspace.')).toBeHidden();

  await invitationAccept.link('Create an account').click();
  await expect(invitationAccept.heading('Join Invitation Flow Workspace')).toBeVisible();
  const signupEmailInput = invitationAccept.field('Email');
  await expect(signupEmailInput).toHaveValue(invitee.email);
  await expect(signupEmailInput).toHaveJSProperty('readOnly', true);

  await invitationAccept.link('Log in').click();
  await expect(invitationAccept.heading('Join Invitation Flow Workspace')).toBeVisible();
  await expect(invitationAccept.field('Email')).toHaveValue(invitee.email);

  await invitationAccept.field('Password').fill(invitee.password);
  await projects.createProject({workspaceId: workspace.id});
  await invitationAccept.button('Log in').click();

  await expect(page).toHaveURL(workspaceUrlRe(workspace.id));
  await expect(invitationAccept.message('You joined Invitation Flow Workspace.')).toBeVisible();

  await membersSettings.goto(workspace.id);
  await expect(membersSettings.heading()).toBeVisible();
  await expect(membersSettings.memberText(owner.email)).toBeVisible();
  await expect(membersSettings.memberText(invitee.email)).toBeVisible();
  await expect(membersSettings.emptyPendingInvitations()).toBeVisible();
  const memberJoinedText = await membersSettings.memberCellText(textRe(invitee.email), 2);
  await stableScreenshot(page, 'members/populated-with-empty-invitations', {
    textReplacements: [
      [owner.email, VISUAL_OWNER_EMAIL],
      [invitee.email, VISUAL_INVITEE_EMAIL],
      [memberJoinedText, VISUAL_JOINED_DATE],
    ],
    hideToaster: true,
  });
});

test('creates an account from an invitation outside the signup allowlist with the email locked', async ({
  page,
  auth,
  invitationAccept,
  membersSettings,
  projects,
  workspaces,
}) => {
  const owner = await auth.createUser({name: 'Signup Owner'});
  const workspace = await workspaces.create({
    userId: owner.user.id,
    userEmail: owner.email,
    userName: owner.user.name,
    name: 'Invitation Signup Workspace',
  });
  const inviteeEmail = `signup-invitee-${randomUUID()}@example.test`;
  const invitation = await workspaces.createInvitation({
    workspaceId: workspace.id,
    email: inviteeEmail,
    invitedByUserId: owner.user.id,
    invitedByDisplay: 'Signup Owner',
  });

  await invitationAccept.goto(invitation.raw_token);
  await invitationAccept.link('Create account').click();

  await expect(invitationAccept.heading('Join Invitation Signup Workspace')).toBeVisible();
  const emailInput = invitationAccept.field('Email');
  await expect(emailInput).toHaveValue(inviteeEmail);
  await expect(emailInput).toHaveJSProperty('readOnly', true);
  await expect(invitationAccept.message('Joining Invitation Signup Workspace.')).toBeHidden();

  await invitationAccept.field('Name').fill('Signup Invitee');
  await invitationAccept.field('Password').fill('correct horse battery staple');
  await projects.createProject({workspaceId: workspace.id});
  await invitationAccept.button('Create account').click();

  await expect(page).toHaveURL(workspaceUrlRe(workspace.id));
  await expect(invitationAccept.message('You joined Invitation Signup Workspace.')).toBeVisible();

  await membersSettings.goto(workspace.id);
  await expect(membersSettings.memberText(inviteeEmail)).toBeVisible();
  await expect(membersSettings.memberText('Signup Invitee')).toBeVisible();
});

test('creates, rejects duplicate, and revokes a pending invitation from members settings', async ({
  page,
  auth,
  membersSettings,
  projects,
  workspaces,
}) => {
  const owner = await auth.createUser({name: 'Settings Owner'});
  const workspace = await workspaces.create({
    userId: owner.user.id,
    userEmail: owner.email,
    userName: owner.user.name,
    name: 'Members Settings Workspace',
  });
  const pendingEmail = `pending-${randomUUID()}@example.test`;
  await projects.createProject({workspaceId: workspace.id});
  await auth.loginAs(page, owner);

  await membersSettings.goto(workspace.id);
  await expect(membersSettings.pendingInvitationsHeading()).toBeVisible();
  await expect(membersSettings.emptyPendingInvitations()).toBeVisible();
  const ownerJoinedText = await membersSettings.memberCellText(textRe(owner.email), 2);
  const ownerRowReplacements = [
    [owner.email, VISUAL_OWNER_EMAIL],
    [ownerJoinedText, VISUAL_JOINED_DATE],
  ] as const;
  await stableScreenshot(page, 'members/pending-invitations-empty', {
    textReplacements: ownerRowReplacements,
    hideToaster: true,
  });

  const firstInviteDialog = await membersSettings.openInviteDialog();
  await expect(firstInviteDialog.locator()).toBeVisible();
  await expect(firstInviteDialog.field('Email')).toBeFocused();
  await stableScreenshot(page, 'members/invite-member-modal-idle', {
    textReplacements: ownerRowReplacements,
    hideToaster: true,
  });

  await firstInviteDialog.field('Email').fill(pendingEmail);
  await firstInviteDialog.confirm('Send invitation');
  await expect(membersSettings.memberText(`Invitation sent to ${pendingEmail}.`)).toBeVisible();
  const pendingInvitationRow = membersSettings.pendingInvitationRow(textRe(pendingEmail));
  await expect(pendingInvitationRow).toBeVisible();
  const pendingExpiresText = await membersSettings.pendingInvitationExpiresText(
    textRe(pendingEmail),
  );
  const pendingRowReplacements = [
    [owner.email, VISUAL_OWNER_EMAIL],
    [pendingEmail, VISUAL_PENDING_EMAIL],
    [ownerJoinedText, VISUAL_JOINED_DATE],
    [pendingExpiresText, VISUAL_EXPIRES_DATE],
  ] as const;
  await stableScreenshot(page, 'members/pending-invitations-populated', {
    textReplacements: pendingRowReplacements,
    hideToaster: true,
  });

  const conflictDialog = await membersSettings.openInviteDialog();
  await expect(conflictDialog.locator()).toBeVisible();
  await expect(conflictDialog.field('Email')).toBeFocused();
  await conflictDialog.field('Email').fill(pendingEmail);
  await conflictDialog.confirm('Send invitation');
  await expect(membersSettings.memberText(PENDING_INVITATION_RE)).toBeVisible();
  await stableScreenshot(page, 'members/invite-member-modal-conflict', {
    textReplacements: pendingRowReplacements,
    hideToaster: true,
  });
  await page.keyboard.press('Escape');

  await pendingInvitationRow.hover();
  await membersSettings.revokeInvitationButton().click();
  await expect(membersSettings.memberText(`Revoke invitation to ${pendingEmail}?`)).toBeVisible();
  await stableScreenshot(page, 'members/revoke-invitation-confirm', {
    textReplacements: pendingRowReplacements,
    hideToaster: true,
  });
  await membersSettings.confirmRevokeButton().click();

  await expect(membersSettings.memberText(`Invitation to ${pendingEmail} revoked.`)).toBeVisible();
  await expect(pendingInvitationRow).toBeHidden();
});

test('renders a missing-token public invitation as an invalid link', async ({
  page,
  invitationAccept,
}) => {
  await invitationAccept.goto();
  await expect(invitationAccept.heading('Invalid link')).toBeVisible();
  await stableScreenshot(page, 'invitations/missing-token');
});

test('renders an invalid public invitation', async ({page, invitationAccept}) => {
  await page.route('**/invitations/preview?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({status: 'invalid'}),
    });
  });
  await invitationAccept.goto(`invalid-${randomUUID()}`);
  await expect(invitationAccept.heading('Invalid invitation')).toBeVisible();
  await stableScreenshot(page, 'invitations/invalid');
});

test('renders an expired public invitation', async ({page, invitationAccept}) => {
  await page.route('**/invitations/preview?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'expired',
        workspace_name: 'Expired Workspace',
        expires_at: '2026-05-01T00:00:00.000Z',
      }),
    });
  });
  await invitationAccept.goto(`expired-${randomUUID()}`);
  await expect(invitationAccept.heading('Invitation expired')).toBeVisible();
  await stableScreenshot(page, 'invitations/expired');
});
