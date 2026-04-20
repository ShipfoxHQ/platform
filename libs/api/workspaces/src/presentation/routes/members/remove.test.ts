import type {FastifyInstance} from 'fastify';
import {
  createInvite,
  createWorkspace,
  createWorkspacesTestApp,
  resetCapturedMail,
  signupVerifyLogin,
} from '#test/routes.js';

describe('DELETE /workspaces/:workspaceId/members/:userId', () => {
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

  test('returns 204 and removes a non-owner member', async () => {
    const owner = await signupVerifyLogin(app, 'members-remove-owner');
    const guest = await signupVerifyLogin(app, 'members-remove-guest');
    const workspaceId = await createWorkspace(app, owner.token);
    const invite = await createInvite(app, {token: owner.token, workspaceId, email: guest.email});
    await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: {authorization: `Bearer ${guest.token}`},
      payload: {token: invite.rawToken},
    });

    const remove = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/members/${guest.userId}`,
      headers: {authorization: `Bearer ${owner.token}`},
    });
    const members = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/members`,
      headers: {authorization: `Bearer ${owner.token}`},
    });

    expect(remove.statusCode).toBe(204);
    expect(members.statusCode).toBe(200);
    expect(members.json().members).toHaveLength(1);
    expect(members.json().members[0].user_id).toBe(owner.userId);
  });

  test('transforms missing member into 404', async () => {
    const owner = await signupVerifyLogin(app, 'members-remove-missing');
    const workspaceId = await createWorkspace(app, owner.token);

    const res = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/members/${crypto.randomUUID()}`,
      headers: {authorization: `Bearer ${owner.token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  test('transforms removing the last member into 409', async () => {
    const owner = await signupVerifyLogin(app, 'members-remove-last');
    const workspaceId = await createWorkspace(app, owner.token);

    const res = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/members/${owner.userId}`,
      headers: {authorization: `Bearer ${owner.token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('last-member');
  });

  test('transforms missing membership into 403', async () => {
    const owner = await signupVerifyLogin(app, 'members-remove-member-owner');
    const outsider = await signupVerifyLogin(app, 'members-remove-outsider');
    const workspaceId = await createWorkspace(app, owner.token);

    const res = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/members/${owner.userId}`,
      headers: {authorization: `Bearer ${outsider.token}`},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });
});
