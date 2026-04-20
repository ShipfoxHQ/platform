import type {FastifyInstance} from 'fastify';
import {
  createInvite,
  createWorkspace,
  createWorkspacesTestApp,
  resetCapturedMail,
  signupVerifyLogin,
} from '#test/routes.js';

describe('GET /workspaces/:workspaceId/members', () => {
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

  test('returns members for a workspace member', async () => {
    const owner = await signupVerifyLogin(app, 'members-list-owner');
    const guest = await signupVerifyLogin(app, 'members-list-guest');
    const workspaceId = await createWorkspace(app, owner.token);
    const invite = await createInvite(app, {token: owner.token, workspaceId, email: guest.email});
    await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: {authorization: `Bearer ${guest.token}`},
      payload: {token: invite.rawToken},
    });

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/members`,
      headers: {authorization: `Bearer ${owner.token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(
      res
        .json()
        .members.map((member: {user_email: string}) => member.user_email)
        .sort(),
    ).toEqual([guest.email, owner.email].sort());
  });

  test('transforms missing membership into 403', async () => {
    const owner = await signupVerifyLogin(app, 'members-list-member-owner');
    const outsider = await signupVerifyLogin(app, 'members-list-outsider');
    const workspaceId = await createWorkspace(app, owner.token);

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/members`,
      headers: {authorization: `Bearer ${outsider.token}`},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });

  test('transforms missing workspace into 404', async () => {
    const owner = await signupVerifyLogin(app, 'members-list-missing-workspace');

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${crypto.randomUUID()}/members`,
      headers: {authorization: `Bearer ${owner.token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });
});
