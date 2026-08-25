import type {FastifyInstance} from 'fastify';
import {
  createExpiredInvite,
  createInvite,
  createWorkspace,
  createWorkspacesTestApp,
  resetCapturedMail,
  signupVerifyLogin,
} from '#test/routes.js';

describe('POST /invitations/accept', () => {
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

  test('returns 201 and creates a membership for a new member', async () => {
    const owner = await signupVerifyLogin(app, 'accept-owner');
    const guest = await signupVerifyLogin(app, 'accept-guest');
    const guestName = 'Accepted Guest';
    const guestToken = `user:${guest.userId}:${guest.email}:${encodeURIComponent(guestName)}`;
    const workspaceId = await createWorkspace(app, owner.token);
    const invite = await createInvite(app, {token: owner.token, workspaceId, email: guest.email});

    const res = await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: {authorization: `Bearer ${guestToken}`},
      payload: {token: invite.rawToken},
    });
    const members = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/members`,
      headers: {authorization: `Bearer ${owner.token}`},
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().already_member).toBe(false);
    expect(res.json().membership).toMatchObject({
      user_id: guest.userId,
      workspace_id: workspaceId,
    });
    expect(members.statusCode).toBe(200);
    expect(members.json().members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_email: guest.email,
          user_name: guestName,
        }),
      ]),
    );
  });

  test('rejects an impersonated session with impersonation-not-permitted', async () => {
    const owner = await signupVerifyLogin(app, 'accept-impersonated-owner');
    const guest = await signupVerifyLogin(app, 'accept-impersonated-guest');
    const workspaceId = await createWorkspace(app, owner.token);
    const invite = await createInvite(app, {
      token: owner.token,
      workspaceId,
      email: guest.email,
    });
    const impersonatorId = crypto.randomUUID();
    const token = `claim:${guest.userId}:${guest.email}:${workspaceId}:active:${impersonatorId}`;

    const res = await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: {authorization: `Bearer ${token}`},
      payload: {token: invite.rawToken},
    });
    const members = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/members`,
      headers: {authorization: `Bearer ${owner.token}`},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('impersonation-not-permitted');
    expect(
      members.json().members.map((member: {user_email: string}) => member.user_email),
    ).not.toContain(guest.email);
  });

  test('returns 200 when the invitee is already a member', async () => {
    const owner = await signupVerifyLogin(app, 'accept-existing-owner');
    const workspaceId = await createWorkspace(app, owner.token);
    const invite = await createInvite(app, {token: owner.token, workspaceId, email: owner.email});

    const res = await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: {authorization: `Bearer ${owner.token}`},
      payload: {token: invite.rawToken},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().already_member).toBe(true);
  });

  test('transforms invalid token into 410', async () => {
    const guest = await signupVerifyLogin(app, 'accept-invalid');

    const res = await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: {authorization: `Bearer ${guest.token}`},
      payload: {token: 'not-a-real-token'},
    });

    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe('token-invalid');
  });

  test('transforms already used token into 410', async () => {
    const owner = await signupVerifyLogin(app, 'accept-used-owner');
    const guest = await signupVerifyLogin(app, 'accept-used-guest');
    const workspaceId = await createWorkspace(app, owner.token);
    const invite = await createInvite(app, {token: owner.token, workspaceId, email: guest.email});
    await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: {authorization: `Bearer ${guest.token}`},
      payload: {token: invite.rawToken},
    });

    const res = await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: {authorization: `Bearer ${guest.token}`},
      payload: {token: invite.rawToken},
    });

    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe('token-already-used');
  });

  test('transforms expired token into 410', async () => {
    const owner = await signupVerifyLogin(app, 'accept-expired-owner');
    const guest = await signupVerifyLogin(app, 'accept-expired-guest');
    const workspaceId = await createWorkspace(app, owner.token);
    const expiredToken = await createExpiredInvite({
      workspaceId,
      email: guest.email,
      invitedByUserId: owner.userId,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: {authorization: `Bearer ${guest.token}`},
      payload: {token: expiredToken},
    });

    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe('token-expired');
  });

  test('transforms email mismatch into 403', async () => {
    const owner = await signupVerifyLogin(app, 'accept-mismatch-owner');
    const invited = await signupVerifyLogin(app, 'accept-mismatch-invited');
    const other = await signupVerifyLogin(app, 'accept-mismatch-other');
    const workspaceId = await createWorkspace(app, owner.token);
    const invite = await createInvite(app, {token: owner.token, workspaceId, email: invited.email});

    const res = await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: {authorization: `Bearer ${other.token}`},
      payload: {token: invite.rawToken},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });
});
