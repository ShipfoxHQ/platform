import {AUTH_PASSWORD_RESET_SEND_REQUESTED, AUTH_USER_SIGNED_UP} from '@shipfox/api-auth-dto';
import {userAccessTokenKey} from '@shipfox/node-auth-root-key';
import type {Mailer, MailMessage} from '@shipfox/node-mailer';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {and, desc, eq, sql} from 'drizzle-orm';
import {
  changePassword,
  confirmPasswordReset as coreConfirmPasswordReset,
  createSessionForUser as coreCreateSessionForUser,
  login as coreLogin,
  refreshAccessToken as coreRefreshAccessToken,
  getCurrentUser,
  logout,
  provisionUser,
  requestPasswordReset,
  signup,
  signupWithInvitation,
} from '#core/auth.js';
import {
  AuthDependencyUnavailableError,
  EmailNotVerifiedError,
  EmailTakenError,
  InvalidCredentialsError,
  TokenInvalidError,
  UserNotFoundError,
} from '#core/errors.js';
import {verifyUserToken} from '#core/jwt.js';
import {db} from '#db/db.js';
import * as refreshTokenDb from '#db/refresh-tokens.js';
import {authOutbox} from '#db/schema/outbox.js';
import {passwordResets} from '#db/schema/password-resets.js';
import {refreshTokens} from '#db/schema/refresh-tokens.js';
import {users} from '#db/schema/users.js';
import {findUserByEmail, findUserById} from '#db/users.js';
import {userFactory} from '#test/index.js';

const testConfig = vi.hoisted(
  (): {
    captured: MailMessage[];
    mailer: Mailer;
    clientBaseUrl: string;
  } => {
    const captured: MailMessage[] = [];
    const mailer: Mailer = {
      send: (message) => {
        captured.push(message);
        return Promise.resolve();
      },
    };
    return {
      captured,
      mailer,
      clientBaseUrl: 'https://app.example.test',
    };
  },
);

vi.mock('#config.js', () => ({
  config: {
    AUTH_JWT_EXPIRES_IN: '15m',
    AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS: 14,
    AUTH_REFRESH_ROTATION_GRACE_SECONDS: 30,
    AUTH_REFRESH_COOKIE_NAME: 'shipfox_refresh_token',
    CLIENT_BASE_URL: testConfig.clientBaseUrl,
  },
  mailer: testConfig.mailer,
}));

vi.mock('@shipfox/node-mailer', () => ({mailer: testConfig.mailer}));

const listMembershipsByUserMock = vi.fn(() =>
  Promise.resolve({memberships: [] as Array<{workspaceId: string; role: 'admin'}>}),
);
const workspaces = {
  listMembershipsForTokenClaims: listMembershipsByUserMock,
  getWorkspaceCreator: vi.fn(),
  preflightInvitationAcceptance: vi.fn(),
  acceptInvitation: vi.fn(),
  requireActiveMembership: vi.fn(),
};

const login = (params: {email: string; password: string}) => coreLogin({...params, workspaces});
const createSessionForUser = (params: {userId?: string; email?: string}) =>
  coreCreateSessionForUser({...params, workspaces});
const refreshAccessToken = (params: {refreshToken: string}) =>
  coreRefreshAccessToken({...params, workspaces});
const confirmPasswordReset = (params: {token: string; newPassword: string}) =>
  coreConfirmPasswordReset({...params, workspaces});

const TOKEN_RE = /token=([\w\-_=]+)/;

function extractToken(link: string | undefined): string {
  const match = link?.match(TOKEN_RE);
  if (!match?.[1]) {
    throw new Error('Expected link to contain a token');
  }
  return match[1];
}

async function outboxEventsTo(email: string, eventType: string) {
  return await db()
    .select()
    .from(authOutbox)
    .where(
      and(eq(authOutbox.eventType, eventType), sql`${authOutbox.payload}->>'email' = ${email}`),
    )
    .orderBy(desc(authOutbox.createdAt));
}

async function latestEmailLinkTo(email: string, eventType: string): Promise<string> {
  const event = (await outboxEventsTo(email, eventType))[0];
  const payload = event?.payload as {resetLink?: string} | undefined;
  const link = payload?.resetLink;
  if (!link) throw new Error(`No ${eventType} outbox link for ${email}`);
  return link;
}

describe('auth core', () => {
  let captured: MailMessage[];

  beforeEach(() => {
    captured = testConfig.captured;
    captured.length = 0;
  });

  test('signup creates an unverified user and sends a verification email', async () => {
    const email = `signup-${crypto.randomUUID()}@example.com`;

    const user = await signup({
      email,
      password: 'correct horse battery staple',
      name: 'Sign Up',
    });

    expect(user.email).toBe(email);
    expect(user.name).toBe('Sign Up');
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.emailChallenge.id).toEqual(expect.any(String));
    expect(user.emailChallenge.nextResendAvailableAt).toBeInstanceOf(Date);
    expect(captured).toHaveLength(1);

    const events = await outboxEventsTo(email, AUTH_USER_SIGNED_UP);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      userId: user.id,
      email,
      name: 'Sign Up',
      viaInvitation: false,
    });
  });

  test('signup rejects duplicate email with a business error', async () => {
    const existing = await userFactory.create({emailVerifiedAt: new Date()});

    const promise = signup({
      email: existing.email,
      password: 'correct horse battery staple',
    });

    await expect(promise).rejects.toBeInstanceOf(EmailTakenError);
  });

  test('signup normalizes the email before checking the policy', async () => {
    const email = `signup-policy-${crypto.randomUUID()}@example.com`;
    const isSignupAllowed = vi.fn().mockResolvedValue({allowed: true});

    await signup({
      email: `  ${email.toUpperCase()}  `,
      password: 'correct horse battery staple',
      signupPolicy: {isSignupAllowed},
    });

    expect(isSignupAllowed).toHaveBeenCalledWith({
      email,
      emailVerified: false,
      source: 'password',
    });
  });

  test('signup denies a new user when the policy does not allow it', async () => {
    const email = `signup-policy-denied-${crypto.randomUUID()}@example.com`;
    const isSignupAllowed = vi.fn().mockResolvedValue({allowed: false});

    await expect(
      signup({
        email,
        password: 'correct horse battery staple',
        signupPolicy: {isSignupAllowed},
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'SignupNotAllowedError',
        message: 'This Shipfox deployment does not accept new accounts right now.',
      }),
    );
    expect(await findUserByEmail({email})).toBeUndefined();
  });

  test('signup fails closed when the policy throws', async () => {
    const email = `signup-policy-error-${crypto.randomUUID()}@example.com`;
    const policyError = new Error('policy unavailable');
    const isSignupAllowed = vi.fn().mockRejectedValue(policyError);

    await expect(
      signup({
        email,
        password: 'correct horse battery staple',
        signupPolicy: {isSignupAllowed},
      }),
    ).rejects.toBe(policyError);
    expect(await findUserByEmail({email})).toBeUndefined();
  });

  test('signup does not check the policy for an existing user', async () => {
    const existing = await userFactory.create({emailVerifiedAt: new Date()});
    const isSignupAllowed = vi.fn().mockResolvedValue({allowed: false});

    await expect(
      signup({
        email: `  ${existing.email.toUpperCase()}  `,
        password: 'correct horse battery staple',
        signupPolicy: {isSignupAllowed},
      }),
    ).rejects.toBeInstanceOf(EmailTakenError);
    expect(isSignupAllowed).not.toHaveBeenCalled();
  });

  test('signup with an invitation writes the signed-up event with its user insert', async () => {
    const email = `signup-invitation-${crypto.randomUUID()}@example.com`;
    const userId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    workspaces.preflightInvitationAcceptance.mockResolvedValueOnce(undefined);
    workspaces.acceptInvitation.mockResolvedValueOnce({
      membership: {id: crypto.randomUUID(), userId, workspaceId},
    });

    const result = await signupWithInvitation({
      email,
      password: 'correct horse battery staple',
      name: 'Invited User',
      invitationToken: `invite-${crypto.randomUUID()}`,
      workspaces,
      signupPolicy: {
        isSignupAllowed: vi.fn().mockRejectedValue(new Error('policy unavailable')),
      },
    });

    const events = await outboxEventsTo(email, AUTH_USER_SIGNED_UP);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      userId: result.user.id,
      email,
      name: 'Invited User',
      viaInvitation: true,
    });
  });

  test('provisionUser creates a verified, password-less user with a normalized email', async () => {
    const email = `Provision-${crypto.randomUUID()}@EXAMPLE.COM`;

    const user = await provisionUser({email, name: 'Provisioned User'});

    expect(user.email).toBe(email.toLowerCase());
    expect(user.name).toBe('Provisioned User');
    expect(user.hashedPassword).toBeNull();
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(user.status).toBe('active');
  });

  test('provisionUser normalizes the email before checking the policy', async () => {
    const email = `provision-policy-${crypto.randomUUID()}@example.com`;
    const isSignupAllowed = vi.fn().mockResolvedValue({allowed: true});

    await provisionUser({
      email: `  ${email.toUpperCase()}  `,
      signupPolicy: {isSignupAllowed},
    });

    expect(isSignupAllowed).toHaveBeenCalledWith({
      email,
      emailVerified: true,
      source: 'external-identity',
    });
  });

  test('provisionUser denies a new user when the policy does not allow it', async () => {
    const email = `provision-policy-denied-${crypto.randomUUID()}@example.com`;
    const isSignupAllowed = vi.fn().mockResolvedValue({allowed: false, message: 'Closed beta'});

    await expect(provisionUser({email, signupPolicy: {isSignupAllowed}})).rejects.toEqual(
      expect.objectContaining({
        name: 'SignupNotAllowedError',
        message: 'Closed beta',
      }),
    );
    expect(await findUserByEmail({email})).toBeUndefined();
  });

  test('provisionUser fails closed when the policy throws', async () => {
    const email = `provision-policy-error-${crypto.randomUUID()}@example.com`;
    const policyError = new Error('policy unavailable');
    const isSignupAllowed = vi.fn().mockRejectedValue(policyError);

    await expect(provisionUser({email, signupPolicy: {isSignupAllowed}})).rejects.toBe(policyError);
    expect(await findUserByEmail({email})).toBeUndefined();
  });

  test('provisionUser returns existing unverified and suspended users unchanged', async () => {
    const unverified = await userFactory.create();
    const suspended = await userFactory.create({emailVerifiedAt: new Date()});
    await db().update(users).set({status: 'suspended'}).where(eq(users.id, suspended.id));
    const storedUnverified = await findUserById({id: unverified.id});
    const storedSuspended = await findUserById({id: suspended.id});
    const isSignupAllowed = vi.fn().mockResolvedValue({allowed: false});

    const existingUnverified = await provisionUser({
      email: `  ${unverified.email.toUpperCase()}  `,
      name: 'Replacement Name',
      signupPolicy: {isSignupAllowed},
    });
    const existingSuspended = await provisionUser({
      email: `  ${suspended.email.toUpperCase()}  `,
      name: 'Replacement Name',
      signupPolicy: {isSignupAllowed},
    });

    expect(existingUnverified).toEqual(storedUnverified);
    expect(existingSuspended).toEqual(storedSuspended);
    expect(isSignupAllowed).not.toHaveBeenCalled();
  });

  test('provisionUser returns one unchanged user for concurrent callbacks', async () => {
    const email = `concurrent-provision-${crypto.randomUUID()}@example.com`;

    const results = await Promise.all(
      Array.from({length: 8}, (_, index) => provisionUser({email, name: `Provider ${index}`})),
    );
    const stored = await findUserByEmail({email});

    expect(new Set(results.map((user) => user.id)).size).toBe(1);
    expect(stored?.id).toBe(results[0]?.id);
    expect(stored?.hashedPassword).toBeNull();
  });

  test('login returns a token for verified users and rejects invalid credentials', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});

    const result = await login({email: user.email, password: user.plainPassword});

    expect(result.token).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.user.id).toBe(user.id);

    const wrongPassword = login({email: user.email, password: 'not the right password'});
    await expect(wrongPassword).rejects.toBeInstanceOf(InvalidCredentialsError);

    const missingUser = login({
      email: `missing-${crypto.randomUUID()}@example.com`,
      password: user.plainPassword,
    });
    await expect(missingUser).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test('login rejects unverified users with a business error', async () => {
    const user = await userFactory.create();

    const promise = login({email: user.email, password: user.plainPassword});

    await expect(promise).rejects.toBeInstanceOf(EmailNotVerifiedError);
  });

  test('password login and reset flows refuse password-less users', async () => {
    const user = await provisionUser({
      email: `password-less-${crypto.randomUUID()}@example.com`,
    });
    const resetToken = `password-less-reset-${crypto.randomUUID()}`;
    await db()
      .insert(passwordResets)
      .values({
        userId: user.id,
        hashedToken: hashOpaqueToken(resetToken),
        expiresAt: new Date(Date.now() + 60_000),
      });

    const passwordLogin = login({email: user.email, password: 'not a configured password'});
    await expect(passwordLogin).rejects.toBeInstanceOf(InvalidCredentialsError);

    await requestPasswordReset({email: user.email});
    expect(await outboxEventsTo(user.email, AUTH_PASSWORD_RESET_SEND_REQUESTED)).toHaveLength(0);

    const passwordReset = confirmPasswordReset({
      token: resetToken,
      newPassword: 'a valid replacement password',
    });
    await expect(passwordReset).rejects.toBeInstanceOf(TokenInvalidError);
    expect((await findUserById({id: user.id}))?.hashedPassword).toBeNull();
  });

  test('createSessionForUser only creates sessions for active verified users', async () => {
    const unverified = await userFactory.create();
    const suspended = await userFactory.create({emailVerifiedAt: new Date()});
    await db().update(users).set({status: 'suspended'}).where(eq(users.id, suspended.id));

    await expect(createSessionForUser({userId: unverified.id})).rejects.toBeInstanceOf(
      EmailNotVerifiedError,
    );
    await expect(createSessionForUser({userId: suspended.id})).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  test('createSessionForUser({email}) resolves surrounding whitespace and mixed case', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});

    const result = await createSessionForUser({email: `  ${user.email.toUpperCase()}  `});

    expect(result.user.id).toBe(user.id);
    expect(result.token).toEqual(expect.any(String));
  });

  test('createSessionForUser({email}) retains eligibility checks', async () => {
    const unverified = await userFactory.create();
    const suspended = await userFactory.create({emailVerifiedAt: new Date()});
    await db().update(users).set({status: 'suspended'}).where(eq(users.id, suspended.id));

    const unverifiedExpectation = expect(
      createSessionForUser({email: unverified.email}),
    ).rejects.toBeInstanceOf(EmailNotVerifiedError);
    const suspendedExpectation = expect(
      createSessionForUser({email: suspended.email}),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    await Promise.all([unverifiedExpectation, suspendedExpectation]);
  });

  test('refreshAccessToken rotates the refresh token', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const loginResult = await login({email: user.email, password: user.plainPassword});

    const refreshed = await refreshAccessToken({refreshToken: loginResult.refreshToken});

    expect(refreshed.token).toEqual(expect.any(String));
    expect(refreshed.refreshToken).toEqual(expect.any(String));
    expect(refreshed.refreshToken).not.toBe(loginResult.refreshToken);
    expect(refreshed.user.id).toBe(user.id);
  });

  test('keeps the refresh-session identity stable across a token refresh', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const initial = await login({email: user.email, password: user.plainPassword});
    const refreshed = await refreshAccessToken({refreshToken: initial.refreshToken});
    const initialClaims = await verifyUserToken({
      token: initial.token,
      secret: userAccessTokenKey(),
    });
    const refreshedClaims = await verifyUserToken({
      token: refreshed.token,
      secret: userAccessTokenKey(),
    });

    expect(refreshedClaims.refreshSessionId).toBe(initialClaims.refreshSessionId);
  });

  test('issues different refresh-session identities for separate sessions of one user', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const first = await login({email: user.email, password: user.plainPassword});
    const second = await login({email: user.email, password: user.plainPassword});
    const firstClaims = await verifyUserToken({token: first.token, secret: userAccessTokenKey()});
    const secondClaims = await verifyUserToken({token: second.token, secret: userAccessTokenKey()});

    expect(secondClaims.refreshSessionId).not.toBe(firstClaims.refreshSessionId);
  });

  test('refreshAccessToken tolerates a concurrent reuse within the grace window', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const loginResult = await login({email: user.email, password: user.plainPassword});

    await refreshAccessToken({refreshToken: loginResult.refreshToken});
    const raced = await refreshAccessToken({refreshToken: loginResult.refreshToken});

    expect(raced.token).toEqual(expect.any(String));
    expect(raced.user.id).toBe(user.id);
    // The racing tab keeps the cookie the winning refresh installed.
    expect(raced.refreshToken).toBeUndefined();
  });

  test('refreshAccessToken rejects a lost rotation claim when the token was revoked', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const loginResult = await login({email: user.email, password: user.plainPassword});
    listMembershipsByUserMock.mockClear();
    vi.spyOn(refreshTokenDb, 'rotateRefreshToken').mockImplementationOnce(async () => {
      await logout({refreshToken: loginResult.refreshToken});
      return undefined;
    });

    const raced = refreshAccessToken({refreshToken: loginResult.refreshToken});

    await expect(raced).rejects.toBeInstanceOf(TokenInvalidError);
    expect(listMembershipsByUserMock).not.toHaveBeenCalled();
  });

  test('refreshAccessToken rejects reuse past the grace window and revokes the session', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const loginResult = await login({email: user.email, password: user.plainPassword});
    const refreshed = await refreshAccessToken({refreshToken: loginResult.refreshToken});
    // Backdate the rotation so the original token is now past the grace window.
    await db()
      .update(refreshTokens)
      .set({rotatedAt: new Date(Date.now() - 60 * 60 * 1000)})
      .where(eq(refreshTokens.hashedToken, hashOpaqueToken(loginResult.refreshToken)));

    const reused = refreshAccessToken({refreshToken: loginResult.refreshToken});

    await expect(reused).rejects.toBeInstanceOf(TokenInvalidError);
    // The successor token is revoked too: reuse is treated as a compromise.
    const successor = refreshed.refreshToken
      ? await refreshTokenDb.findActiveRefreshTokenByHash({
          hashedToken: hashOpaqueToken(refreshed.refreshToken),
        })
      : undefined;
    expect(successor).toBeUndefined();
  });

  test('refreshAccessToken rejects refresh tokens for inactive users', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const loginResult = await login({email: user.email, password: user.plainPassword});
    await db().update(users).set({status: 'suspended'}).where(eq(users.id, user.id));

    const promise = refreshAccessToken({refreshToken: loginResult.refreshToken});

    await expect(promise).rejects.toBeInstanceOf(TokenInvalidError);
  });

  test('password reset request and confirm update the password and invalidate the token', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const loginResult = await login({email: user.email, password: user.plainPassword});
    const newPassword = 'new password is also long';

    await requestPasswordReset({email: user.email});
    const resetToken = extractToken(
      await latestEmailLinkTo(user.email, AUTH_PASSWORD_RESET_SEND_REQUESTED),
    );
    const resetResult = await confirmPasswordReset({token: resetToken, newPassword});

    const oldLogin = login({email: user.email, password: user.plainPassword});
    await expect(oldLogin).rejects.toBeInstanceOf(InvalidCredentialsError);

    const newLogin = await login({email: user.email, password: newPassword});
    expect(resetResult.token).toEqual(expect.any(String));
    expect(resetResult.refreshToken).toEqual(expect.any(String));
    expect(resetResult.user.id).toBe(user.id);
    expect(newLogin.user.id).toBe(user.id);

    const oldRefresh = refreshAccessToken({refreshToken: loginResult.refreshToken});
    await expect(oldRefresh).rejects.toBeInstanceOf(TokenInvalidError);

    const reused = confirmPasswordReset({token: resetToken, newPassword});
    await expect(reused).rejects.toBeInstanceOf(TokenInvalidError);
  });

  test('requestPasswordReset does not send email for missing users', async () => {
    const email = `missing-reset-${crypto.randomUUID()}@example.com`;

    await requestPasswordReset({email});

    expect(captured).toHaveLength(0);
    expect(await outboxEventsTo(email, AUTH_PASSWORD_RESET_SEND_REQUESTED)).toHaveLength(0);
  });

  test('changePassword validates the current password and updates the password', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const loginResult = await login({email: user.email, password: user.plainPassword});
    const otherLoginResult = await login({email: user.email, password: user.plainPassword});
    const newPassword = 'new password is also long';

    await changePassword({
      userId: user.id,
      currentPassword: user.plainPassword,
      newPassword,
      refreshToken: loginResult.refreshToken,
    });

    const oldLogin = login({email: user.email, password: user.plainPassword});
    await expect(oldLogin).rejects.toBeInstanceOf(InvalidCredentialsError);

    const newLogin = await login({email: user.email, password: newPassword});

    expect(newLogin.user.id).toBe(user.id);

    const currentRefresh = await refreshAccessToken({refreshToken: loginResult.refreshToken});
    const otherRefresh = refreshAccessToken({refreshToken: otherLoginResult.refreshToken});

    expect(currentRefresh.user.id).toBe(user.id);
    await expect(otherRefresh).rejects.toBeInstanceOf(TokenInvalidError);
  });

  test('changePassword rejects unknown users and invalid current passwords', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});

    const missingUser = changePassword({
      userId: crypto.randomUUID(),
      currentPassword: user.plainPassword,
      newPassword: 'new password is also long',
    });
    await expect(missingUser).rejects.toBeInstanceOf(UserNotFoundError);

    const badPassword = changePassword({
      userId: user.id,
      currentPassword: 'not the right password',
      newPassword: 'new password is also long',
    });
    await expect(badPassword).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test('logout revokes the presented refresh token', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const loginResult = await login({email: user.email, password: user.plainPassword});

    await logout({refreshToken: loginResult.refreshToken});

    const active = await refreshTokenDb.findActiveRefreshTokenByHash({
      hashedToken: hashOpaqueToken(loginResult.refreshToken),
    });
    expect(active).toBeUndefined();
  });

  test('logout revokes the active successor when presented a rotated refresh token', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const loginResult = await login({email: user.email, password: user.plainPassword});
    const refreshed = await refreshAccessToken({refreshToken: loginResult.refreshToken});

    await logout({refreshToken: loginResult.refreshToken});

    const successor = refreshed.refreshToken
      ? await refreshTokenDb.findActiveRefreshTokenByHash({
          hashedToken: hashOpaqueToken(refreshed.refreshToken),
        })
      : undefined;
    expect(successor).toBeUndefined();
  });

  test('getCurrentUser returns the user', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});

    const result = await getCurrentUser({userId: user.id});

    expect(result.user.id).toBe(user.id);
  });

  test('getCurrentUser rejects unknown users', async () => {
    const userId = crypto.randomUUID();

    const promise = getCurrentUser({userId});

    await expect(promise).rejects.toBeInstanceOf(UserNotFoundError);
  });

  test('confirmPasswordReset rejects invalid tokens', async () => {
    const token = `missing-${crypto.randomUUID()}`;

    const promise = confirmPasswordReset({token, newPassword: 'new password is also long'});

    await expect(promise).rejects.toBeInstanceOf(TokenInvalidError);
  });

  test('requestPasswordReset sends reset email for active users', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});

    await requestPasswordReset({email: user.email});

    expect(captured).toHaveLength(0);
    expect(await latestEmailLinkTo(user.email, AUTH_PASSWORD_RESET_SEND_REQUESTED)).toContain(
      `${testConfig.clientBaseUrl}/auth/reset?token=`,
    );
  });

  test('signup persists a hashed password', async () => {
    const email = `hashed-${crypto.randomUUID()}@example.com`;
    const password = 'correct horse battery staple';

    await signup({email, password});
    const user = await findUserByEmail({email});

    expect(user?.hashedPassword).toEqual(expect.any(String));
    expect(user?.hashedPassword).not.toBe(password);
  });

  test('login embeds the user current memberships into the access token', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const workspaceA = crypto.randomUUID();
    const workspaceB = crypto.randomUUID();
    listMembershipsByUserMock.mockResolvedValueOnce({
      memberships: [
        {workspaceId: workspaceA, role: 'admin'},
        {workspaceId: workspaceB, role: 'admin'},
      ],
    });

    const result = await login({email: user.email, password: user.plainPassword});

    const claims = await verifyUserToken({token: result.token, secret: userAccessTokenKey()});
    expect(claims.name).toBe(user.name);
    expect(claims.memberships).toEqual([
      {workspaceId: workspaceA, role: 'admin'},
      {workspaceId: workspaceB, role: 'admin'},
    ]);
  });

  test('refresh re-fetches memberships so newly-added workspaces appear in the next token', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    listMembershipsByUserMock.mockResolvedValueOnce({memberships: []});
    const loginResult = await login({email: user.email, password: user.plainPassword});

    const newWorkspaceId = crypto.randomUUID();
    listMembershipsByUserMock.mockResolvedValueOnce({
      memberships: [{workspaceId: newWorkspaceId, role: 'admin'}],
    });
    const refreshed = await refreshAccessToken({refreshToken: loginResult.refreshToken});

    const refreshedClaims = await verifyUserToken({
      token: refreshed.token,
      secret: userAccessTokenKey(),
    });
    expect(refreshedClaims.memberships).toEqual([{workspaceId: newWorkspaceId, role: 'admin'}]);
  });

  test('login fails closed when listMembershipsByUser throws', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    listMembershipsByUserMock.mockRejectedValueOnce(new Error('workspaces DB down'));

    const promise = login({email: user.email, password: user.plainPassword});

    await expect(promise).rejects.toBeInstanceOf(AuthDependencyUnavailableError);
  });

  test('refresh fails closed when listMembershipsByUser throws', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    listMembershipsByUserMock.mockResolvedValueOnce({memberships: []});
    const loginResult = await login({email: user.email, password: user.plainPassword});

    listMembershipsByUserMock.mockRejectedValueOnce(new Error('workspaces DB down'));
    const promise = refreshAccessToken({refreshToken: loginResult.refreshToken});

    await expect(promise).rejects.toBeInstanceOf(AuthDependencyUnavailableError);
  });
});
