import type {FastifyInstance} from 'fastify';
import {
  capturedMail,
  createInvite,
  createWorkspace,
  createWorkspacesTestApp,
  invitationOutboxEventsTo,
  resetCapturedMail,
  signupVerifyLogin,
  uniqueEmail,
} from '#test/routes.js';

describe('POST /workspaces/:workspaceId/invitations', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createWorkspacesTestApp();
  });

  beforeEach(() => {
    resetCapturedMail();
  });

  afterAll(async () => {
    await app.close();
  });

  test('returns 201 with an invitation for a workspace member', async () => {
    const owner = await signupVerifyLogin(app, 'invite-create-owner');
    const workspaceId = await createWorkspace(app, owner.token);
    const inviteeEmail = uniqueEmail('invite-create');

    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/invitations`,
      headers: {authorization: `Bearer ${owner.token}`},
      payload: {email: `  ${inviteeEmail.toUpperCase()}  `},
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      workspace_id: workspaceId,
      email: inviteeEmail,
      accepted_at: null,
      invited_by_user_id: owner.userId,
    });
    expect(await invitationOutboxEventsTo(inviteeEmail)).toHaveLength(1);
    expect(capturedMail()).toHaveLength(0);
  });

  test('transforms duplicate open invitation into 409', async () => {
    const owner = await signupVerifyLogin(app, 'invite-create-duplicate');
    const workspaceId = await createWorkspace(app, owner.token);
    const inviteeEmail = uniqueEmail('duplicate-invite');
    await createInvite(app, {token: owner.token, workspaceId, email: inviteeEmail});

    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/invitations`,
      headers: {authorization: `Bearer ${owner.token}`},
      payload: {email: inviteeEmail},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('open-invitation-exists');
    expect(await invitationOutboxEventsTo(inviteeEmail)).toHaveLength(1);
  });

  test('returns workspace-suspended for a suspended membership claim', async () => {
    const workspaceId = crypto.randomUUID();
    const token = `claim:${crypto.randomUUID()}:suspended-invite-create@example.com:${workspaceId}:suspended`;

    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/invitations`,
      headers: {authorization: `Bearer ${token}`},
      payload: {email: uniqueEmail('suspended-invite')},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('workspace-suspended');
  });

  test('rejects an impersonated session with impersonation-not-permitted', async () => {
    const workspaceId = crypto.randomUUID();
    const inviteeEmail = uniqueEmail('impersonated-invite');
    const token = `claim:${crypto.randomUUID()}:impersonated-invite-create@example.com:${workspaceId}:active:${crypto.randomUUID()}`;

    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/invitations`,
      headers: {authorization: `Bearer ${token}`},
      payload: {email: inviteeEmail},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('impersonation-not-permitted');
    expect(await invitationOutboxEventsTo(inviteeEmail)).toHaveLength(0);
  });

  test('transforms a whitespace/case-equivalent duplicate open invitation into 409', async () => {
    const owner = await signupVerifyLogin(app, 'invite-create-duplicate-equivalent');
    const workspaceId = await createWorkspace(app, owner.token);
    const inviteeEmail = uniqueEmail('duplicate-invite-equivalent');
    await createInvite(app, {token: owner.token, workspaceId, email: inviteeEmail});

    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/invitations`,
      headers: {authorization: `Bearer ${owner.token}`},
      payload: {email: `  ${inviteeEmail.toUpperCase()}  `},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('open-invitation-exists');
    expect(await invitationOutboxEventsTo(inviteeEmail)).toHaveLength(1);
  });

  test('transforms missing membership into 403', async () => {
    const outsider = await signupVerifyLogin(app, 'invite-create-outsider');
    const workspaceId = crypto.randomUUID();
    const inviteeEmail = uniqueEmail('forbidden-invite');

    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/invitations`,
      headers: {authorization: `Bearer ${outsider.token}`},
      payload: {email: inviteeEmail},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
    expect(await invitationOutboxEventsTo(inviteeEmail)).toHaveLength(0);
  });

  test('returns 403 when caller has no claim to the workspace (whether or not it exists)', async () => {
    const owner = await signupVerifyLogin(app, 'invite-create-missing-workspace');

    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${crypto.randomUUID()}/invitations`,
      headers: {authorization: `Bearer ${owner.token}`},
      payload: {email: uniqueEmail('missing-workspace-invite')},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });
});
