import type {FastifyInstance} from 'fastify';
import {
  createInvite,
  createWorkspace,
  createWorkspacesTestApp,
  resetCapturedMail,
  signupVerifyLogin,
  uniqueEmail,
} from '#test/routes.js';

describe('GET /workspaces/:workspaceId/invitations', () => {
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

  test('returns open invitations for a workspace member', async () => {
    const owner = await signupVerifyLogin(app, 'invite-list-owner');
    const workspaceId = await createWorkspace(app, owner.token);
    const inviteeEmail = uniqueEmail('invite-list');
    const invite = await createInvite(app, {token: owner.token, workspaceId, email: inviteeEmail});

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/invitations`,
      headers: {authorization: `Bearer ${owner.token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().invitations).toEqual([
      expect.objectContaining({
        id: invite.id,
        workspace_id: workspaceId,
        email: inviteeEmail,
      }),
    ]);
  });

  test('transforms missing membership into 403', async () => {
    const owner = await signupVerifyLogin(app, 'invite-list-member-owner');
    const outsider = await signupVerifyLogin(app, 'invite-list-outsider');
    const workspaceId = await createWorkspace(app, owner.token);

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/invitations`,
      headers: {authorization: `Bearer ${outsider.token}`},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });

  test('transforms missing workspace into 404', async () => {
    const owner = await signupVerifyLogin(app, 'invite-list-missing-workspace');

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${crypto.randomUUID()}/invitations`,
      headers: {authorization: `Bearer ${owner.token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });
});
