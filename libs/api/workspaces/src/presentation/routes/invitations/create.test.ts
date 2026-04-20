import type {FastifyInstance} from 'fastify';
import {
  createInvite,
  createWorkspace,
  createWorkspacesTestApp,
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
      payload: {email: inviteeEmail.toUpperCase()},
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      workspace_id: workspaceId,
      email: inviteeEmail,
      accepted_at: null,
      invited_by_user_id: owner.userId,
    });
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
  });

  test('transforms missing membership into 403', async () => {
    const owner = await signupVerifyLogin(app, 'invite-create-member-owner');
    const outsider = await signupVerifyLogin(app, 'invite-create-outsider');
    const workspaceId = await createWorkspace(app, owner.token);

    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/invitations`,
      headers: {authorization: `Bearer ${outsider.token}`},
      payload: {email: uniqueEmail('forbidden-invite')},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });

  test('transforms missing workspace into 404', async () => {
    const owner = await signupVerifyLogin(app, 'invite-create-missing-workspace');

    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${crypto.randomUUID()}/invitations`,
      headers: {authorization: `Bearer ${owner.token}`},
      payload: {email: uniqueEmail('missing-workspace-invite')},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });
});
