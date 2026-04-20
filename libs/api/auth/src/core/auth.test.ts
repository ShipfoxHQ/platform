import type {Mailer, MailMessage} from '@shipfox/node-mailer';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {eq} from 'drizzle-orm';
import {
  changePassword,
  confirmEmailVerification,
  confirmPasswordReset,
  getCurrentUser,
  login,
  logout,
  refreshAccessToken,
  requestPasswordReset,
  resendEmailVerification,
  signup,
} from '#core/auth.js';
import {
  EmailNotVerifiedError,
  EmailTakenError,
  InvalidCredentialsError,
  TokenInvalidError,
  UserNotFoundError,
} from '#core/errors.js';
import {db} from '#db/db.js';
import {findActiveRefreshTokenByHash} from '#db/refresh-tokens.js';
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
    AUTH_JWT_SECRET: 'auth-core-test-secret',
    AUTH_JWT_EXPIRES_IN: '15m',
    AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS: 14,
    AUTH_REFRESH_COOKIE_NAME: 'shipfox_refresh_token',
    CLIENT_BASE_URL: testConfig.clientBaseUrl,
  },
  mailer: testConfig.mailer,
}));

const TOKEN_RE = /token=([\w\-_=]+)/;

function extractToken(message: MailMessage | undefined): string {
  const match = message?.text?.match(TOKEN_RE);
  if (!match?.[1]) {
    throw new Error('Expected message to contain a token link');
  }
  return match[1];
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
    expect(captured).toHaveLength(1);
    expect(captured[0]?.to).toBe(email);
    expect(captured[0]?.text).toContain(`${testConfig.clientBaseUrl}/auth/verify-email?token=`);
  });

  test('signup rejects duplicate email with a business error', async () => {
    const existing = await userFactory.create();

    const promise = signup({
      email: existing.email,
      password: 'correct horse battery staple',
    });

    await expect(promise).rejects.toBeInstanceOf(EmailTakenError);
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

  test('refreshAccessToken rotates the refresh token and rejects stale reuse', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const loginResult = await login({email: user.email, password: user.plainPassword});

    const refreshed = await refreshAccessToken({refreshToken: loginResult.refreshToken});
    const stale = refreshAccessToken({refreshToken: loginResult.refreshToken});

    expect(refreshed.token).toEqual(expect.any(String));
    expect(refreshed.refreshToken).not.toBe(loginResult.refreshToken);
    expect(refreshed.user.id).toBe(user.id);
    await expect(stale).rejects.toBeInstanceOf(TokenInvalidError);
  });

  test('refreshAccessToken rejects refresh tokens for inactive users', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const loginResult = await login({email: user.email, password: user.plainPassword});
    await db().update(users).set({status: 'suspended'}).where(eq(users.id, user.id));

    const promise = refreshAccessToken({refreshToken: loginResult.refreshToken});

    await expect(promise).rejects.toBeInstanceOf(TokenInvalidError);
  });

  test('confirmEmailVerification marks the user verified, creates a session, and rejects reused tokens', async () => {
    const user = await signup({
      email: `verify-${crypto.randomUUID()}@example.com`,
      password: 'correct horse battery staple',
    });
    const token = extractToken(captured[0]);

    const result = await confirmEmailVerification({token});
    const verified = await findUserById({id: user.id});
    const refreshSession = await findActiveRefreshTokenByHash({
      hashedToken: hashOpaqueToken(result.refreshToken),
    });
    const reused = confirmEmailVerification({token});

    expect(verified?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(result.token).toEqual(expect.any(String));
    expect(result.user.id).toBe(user.id);
    expect(refreshSession?.userId).toBe(user.id);
    await expect(reused).rejects.toBeInstanceOf(TokenInvalidError);
  });

  test('resendEmailVerification only sends for active unverified users', async () => {
    const unverified = await userFactory.create();
    const verified = await userFactory.create({emailVerifiedAt: new Date()});

    await resendEmailVerification({email: unverified.email});
    await resendEmailVerification({email: verified.email});
    await resendEmailVerification({email: `missing-${crypto.randomUUID()}@example.com`});

    expect(captured).toHaveLength(1);
    expect(captured[0]?.to).toBe(unverified.email);
  });

  test('password reset request and confirm update the password and invalidate the token', async () => {
    const user = await userFactory.create({emailVerifiedAt: new Date()});
    const loginResult = await login({email: user.email, password: user.plainPassword});
    const newPassword = 'new password is also long';

    await requestPasswordReset({email: user.email});
    const resetToken = extractToken(captured[0]);
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

    const active = await findActiveRefreshTokenByHash({
      hashedToken: hashOpaqueToken(loginResult.refreshToken),
    });
    expect(active).toBeUndefined();
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

    expect(captured).toHaveLength(1);
    expect(captured[0]?.to).toBe(user.email);
    expect(captured[0]?.text).toContain(`${testConfig.clientBaseUrl}/auth/reset?token=`);
  });

  test('signup persists a hashed password', async () => {
    const email = `hashed-${crypto.randomUUID()}@example.com`;
    const password = 'correct horse battery staple';

    await signup({email, password});
    const user = await findUserByEmail({email});

    expect(user?.hashedPassword).toEqual(expect.any(String));
    expect(user?.hashedPassword).not.toBe(password);
  });
});
