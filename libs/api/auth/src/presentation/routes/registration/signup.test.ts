import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {workspacesInterModuleContract} from '@shipfox/api-workspaces-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import {SignupNotAllowedError} from '#core/errors.js';
import {verifyUserToken} from '#core/jwt.js';
import {
  acceptWorkspaceInvitationMock,
  capturedMail,
  createAuthTestApp,
  getSetCookie,
  listMembershipsByUserMock,
  peekInvitationByRawTokenMock,
  ROUTE_TEST_SECRET,
  resetCapturedMail,
  signup,
  uniqueEmail,
} from '#test/routes.js';
import {createSignupRoute} from './signup.js';

describe('POST /auth/signup', () => {
  let app: FastifyInstance;
  const password = 'correct horse battery staple';

  beforeAll(async () => {
    app = await createAuthTestApp();
  });

  beforeEach(() => {
    resetCapturedMail();
  });

  test('maps a denied signup to a bounded client error', () => {
    const errorHandler = createSignupRoute({} as WorkspacesInterModuleClient).errorHandler as (
      error: unknown,
    ) => never;
    const message = 'x'.repeat(501);
    let mapped: unknown;

    try {
      errorHandler(new SignupNotAllowedError(message));
    } catch (error) {
      mapped = error;
    }

    expect(mapped).toBeInstanceOf(ClientError);
    expect(mapped).toMatchObject({
      message: 'x'.repeat(500),
      status: 403,
      code: 'signup-not-allowed',
      details: {message: 'x'.repeat(500)},
    });
  });

  afterAll(async () => {
    await app.close();
  });

  test('returns 201 with a pending user and sends verification mail', async () => {
    const email = uniqueEmail('signup');

    const res = await signup(app, {
      email: `  ${email.toUpperCase()}  `,
      password,
      name: '  New User  ',
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().user.email).toBe(email);
    expect(res.json().user.name).toBe('New User');
    expect(res.json().user.email_verified_at).toBeNull();
    expect(res.json().email_challenge).toEqual({
      id: expect.any(String),
      next_resend_available_at: expect.any(String),
    });
    expect(capturedMail()).toHaveLength(1);
  });

  test.each([
    ['missing', undefined],
    ['blank after trimming', '   '],
    ['with control characters', 'New\nUser'],
    ['with format characters', 'New\u202eUser'],
  ])('rejects a %s display name', async (_case, name) => {
    const email = uniqueEmail('signup-name-invalid');
    const payload: {email: string; password: string; name?: string} = {email, password};
    if (name !== undefined) {
      payload.name = name;
    }

    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload,
    });

    expect(res.statusCode).toBe(400);
  });

  test('resumes verification when an unverified user retries signup with the same password', async () => {
    const email = uniqueEmail('duplicate');
    await signup(app, {email, password});

    const res = await signup(app, {email, password});

    expect(res.statusCode).toBe(201);
    expect(res.json().email_challenge.id).toEqual(expect.any(String));
  });

  test('normalizes email when resuming verification', async () => {
    const email = uniqueEmail('duplicate-equivalent');
    await signup(app, {email, password});

    const res = await signup(app, {email: `  ${email.toUpperCase()}  `, password});

    expect(res.statusCode).toBe(201);
    expect(res.json().email_challenge.id).toEqual(expect.any(String));
  });

  test('accepts a valid invitation during signup and skips verification email', async () => {
    const email = uniqueEmail('signup-invite');
    const invitationToken = `invite-${crypto.randomUUID()}`;
    const workspaceId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    peekInvitationByRawTokenMock.mockResolvedValueOnce({
      id: crypto.randomUUID(),
      workspaceId,
      email,
      hashedToken: 'hashed',
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      acceptedAt: null,
      acceptedByUserId: null,
      invitedByUserId: crypto.randomUUID(),
      invitedByDisplay: 'owner@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    acceptWorkspaceInvitationMock.mockImplementationOnce(async (params) => ({
      invitation: {
        id: crypto.randomUUID(),
        workspaceId,
        email,
        hashedToken: 'hashed',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null,
        acceptedAt: new Date(),
        acceptedByUserId: params.userId,
        invitedByUserId: crypto.randomUUID(),
        invitedByDisplay: 'owner@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      membership: {
        id: membershipId,
        userId: params.userId,
        userEmail: email,
        userName: 'Invitee',
        workspaceId,
        workspaceName: 'Acme',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      alreadyMember: false,
    }));
    listMembershipsByUserMock.mockResolvedValueOnce({
      memberships: [{workspaceId, role: 'admin' as const}],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        email,
        password,
        name: 'Invitee',
        invitation_token: invitationToken,
      },
    });
    const body = res.json();
    const claims = await verifyUserToken({token: body.token, secret: ROUTE_TEST_SECRET});

    expect(res.statusCode).toBe(201);
    expect(getSetCookie(res)).toContain('shipfox_refresh_token=');
    expect(body.user.email).toBe(email);
    expect(body.user.email_verified_at).toEqual(expect.any(String));
    expect(body.membership).toEqual({
      id: membershipId,
      user_id: body.user.id,
      workspace_id: workspaceId,
    });
    expect(body.accept_error).toBeUndefined();
    expect(claims.memberships).toEqual([{workspaceId, role: 'admin'}]);
    expect(capturedMail()).toHaveLength(0);
  });

  test('returns partial success when invitation acceptance fails after user creation', async () => {
    const email = uniqueEmail('signup-invite-partial');
    const workspaceId = crypto.randomUUID();
    peekInvitationByRawTokenMock.mockResolvedValueOnce({
      id: crypto.randomUUID(),
      workspaceId,
      email,
      hashedToken: 'hashed',
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      acceptedAt: null,
      acceptedByUserId: null,
      invitedByUserId: crypto.randomUUID(),
      invitedByDisplay: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    acceptWorkspaceInvitationMock.mockRejectedValueOnce(new Error('accept unavailable'));

    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        email,
        password,
        name: 'Invitee',
        invitation_token: `invite-${crypto.randomUUID()}`,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().membership).toBeNull();
    expect(res.json().accept_error).toEqual(
      expect.objectContaining({
        code: 'AcceptFailed',
      }),
    );
    expect(res.json().token).toEqual(expect.any(String));
  });

  test.each([
    {name: 'invalid token', expectedCode: 'invitation-token-invalid' as const, expectedStatus: 410},
    {
      name: 'already accepted token',
      expectedCode: 'invitation-token-used' as const,
      expectedStatus: 410,
    },
    {name: 'expired token', expectedCode: 'invitation-token-expired' as const, expectedStatus: 410},
    {
      name: 'email mismatch',
      expectedCode: 'invitation-email-mismatch' as const,
      expectedStatus: 403,
    },
  ])('rejects signup with invitation for $name', async ({expectedCode, expectedStatus}) => {
    const email = uniqueEmail('signup-invite-error');
    peekInvitationByRawTokenMock.mockRejectedValueOnce(
      createInterModuleKnownError(
        workspacesInterModuleContract.methods.preflightInvitationAcceptance,
        expectedCode,
        {},
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        email,
        password,
        name: 'Invitee',
        invitation_token: `invite-${crypto.randomUUID()}`,
      },
    });

    expect(res.statusCode).toBe(expectedStatus);
    expect(res.json().code).toBe(expectedCode);
    expect(acceptWorkspaceInvitationMock).not.toHaveBeenCalled();
  });
});
