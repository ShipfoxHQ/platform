import type {FastifyInstance} from 'fastify';
import {
  createInvite,
  createWorkspace,
  createWorkspacesTestApp,
  resetCapturedMail,
  signupVerifyLogin,
  uniqueEmail,
} from '#test/routes.js';

describe('DELETE /workspaces/:workspaceId/invitations/:invitationId', () => {
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

  test('returns 204 and removes an open invitation', async () => {
    const owner = await signupVerifyLogin(app, 'invite-revoke-owner');
    const workspaceId = await createWorkspace(app, owner.token);
    const invite = await createInvite(app, {
      token: owner.token,
      workspaceId,
      email: uniqueEmail('invite-revoke'),
    });

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/invitations/${invite.id}`,
      headers: {authorization: `Bearer ${owner.token}`},
    });
    const list = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/invitations`,
      headers: {authorization: `Bearer ${owner.token}`},
    });

    expect(revoke.statusCode).toBe(204);
    expect(list.statusCode).toBe(200);
    expect(list.json().invitations).toHaveLength(0);
  });

  test('transforms missing invitation into 404', async () => {
    const owner = await signupVerifyLogin(app, 'invite-revoke-missing');
    const workspaceId = await createWorkspace(app, owner.token);

    const res = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/invitations/${crypto.randomUUID()}`,
      headers: {authorization: `Bearer ${owner.token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  test('transforms invitation workspace mismatch into 403', async () => {
    const owner = await signupVerifyLogin(app, 'invite-revoke-mismatch');
    const firstWorkspaceId = await createWorkspace(app, owner.token);
    const secondWorkspaceId = await createWorkspace(app, owner.token);
    const invite = await createInvite(app, {
      token: owner.token,
      workspaceId: firstWorkspaceId,
      email: uniqueEmail('mismatch-invitee'),
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${secondWorkspaceId}/invitations/${invite.id}`,
      headers: {authorization: `Bearer ${owner.token}`},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });

  test('transforms missing membership into 403', async () => {
    const owner = await signupVerifyLogin(app, 'invite-revoke-member-owner');
    const outsider = await signupVerifyLogin(app, 'invite-revoke-outsider');
    const workspaceId = await createWorkspace(app, owner.token);
    const invite = await createInvite(app, {
      token: owner.token,
      workspaceId,
      email: uniqueEmail('forbidden-revoke'),
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/invitations/${invite.id}`,
      headers: {authorization: `Bearer ${outsider.token}`},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });
});
