import type {FastifyInstance} from 'fastify';
import {createWorkspace as createWorkspaceRow} from '#db/workspaces.js';
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

  test('authorizes from a static membership claim without a membership row', async () => {
    const userId = crypto.randomUUID();
    const email = `members-list-claim-${crypto.randomUUID()}@example.com`;
    const workspace = await createWorkspaceRow({name: `Workspace ${crypto.randomUUID()}`});
    const token = `claim:${userId}:${email}:${workspace.id}`;

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspace.id}/members`,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().members).toEqual([]);
  });

  test('returns workspace-suspended for a suspended membership claim', async () => {
    const workspaceId = crypto.randomUUID();
    const token = `claim:${crypto.randomUUID()}:suspended-list@example.com:${workspaceId}:suspended`;

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/members`,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('workspace-suspended');
  });

  test('transforms missing membership into 403', async () => {
    const outsider = await signupVerifyLogin(app, 'members-list-outsider');
    const workspaceId = crypto.randomUUID();

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/members`,
      headers: {authorization: `Bearer ${outsider.token}`},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });

  test('returns 403 when caller has no claim to the workspace (whether or not it exists)', async () => {
    const owner = await signupVerifyLogin(app, 'members-list-missing-workspace');

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${crypto.randomUUID()}/members`,
      headers: {authorization: `Bearer ${owner.token}`},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });
});
