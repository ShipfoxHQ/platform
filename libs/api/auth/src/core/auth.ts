import {generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {config, mailer} from '#config.js';
import {consumeEmailVerification, createEmailVerification} from '#db/email-verifications.js';
import {consumePasswordReset, createPasswordReset} from '#db/password-resets.js';
import {
  createRefreshToken,
  findActiveRefreshTokenByHash,
  revokeRefreshTokenByHash,
  revokeRefreshTokensForUser,
  rotateActiveRefreshToken,
} from '#db/refresh-tokens.js';
import {
  createUser as createDbUser,
  findUserByEmail,
  findUserById,
  markEmailVerified,
  updateUserPassword,
} from '#db/users.js';
import type {User} from './entities/user.js';
import {
  EmailNotVerifiedError,
  EmailTakenError,
  InvalidCredentialsError,
  TokenInvalidError,
  UserNotFoundError,
} from './errors.js';
import {signUserToken} from './jwt.js';
import {hashPassword, verifyPassword} from './password.js';

const VERIFICATION_TTL_HOURS = 24;
const RESET_TTL_HOURS = 1;

let dummyHashCache: string | undefined;
async function getDummyHash(): Promise<string> {
  if (!dummyHashCache) {
    dummyHashCache = await hashPassword({password: 'dummy-for-timing-parity'});
  }
  return dummyHashCache;
}

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function signAccessToken(user: User): Promise<string> {
  return await signUserToken({
    userId: user.id,
    email: user.email,
    secret: config.AUTH_JWT_SECRET,
    expiresIn: config.AUTH_JWT_EXPIRES_IN,
  });
}

async function createRefreshSession(user: User): Promise<string> {
  const refreshToken = generateOpaqueToken('refreshToken');
  await createRefreshToken({
    userId: user.id,
    hashedToken: hashOpaqueToken(refreshToken),
    expiresAt: daysFromNow(config.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS),
  });
  return refreshToken;
}

async function sendVerificationEmail(user: User, rawToken: string): Promise<void> {
  const link = `${config.CLIENT_BASE_URL}/auth/verify-email?token=${rawToken}`;
  await mailer.send({
    to: user.email,
    subject: 'Verify your email',
    text: `Click to verify your email: ${link}`,
    html: `<p>Click to verify your email: <a href="${link}">${link}</a></p>`,
  });
}

async function createAndSendEmailVerification(user: User): Promise<void> {
  const rawToken = generateOpaqueToken('emailVerification');
  await createEmailVerification({
    userId: user.id,
    hashedToken: hashOpaqueToken(rawToken),
    expiresAt: hoursFromNow(VERIFICATION_TTL_HOURS),
  });

  await sendVerificationEmail(user, rawToken);
}

export interface SignupParams {
  email: string;
  password: string;
  name?: string | undefined;
}

export async function signup(params: SignupParams): Promise<User> {
  const existing = await findUserByEmail({email: params.email});
  if (existing) {
    throw new EmailTakenError(params.email);
  }

  const hashedPassword = await hashPassword({password: params.password});
  const user = await createDbUser({
    email: params.email,
    hashedPassword,
    name: params.name ?? null,
  });

  await createAndSendEmailVerification(user);

  return user;
}

export interface CreateUserParams extends SignupParams {
  verified: boolean;
}

export async function createUser(params: CreateUserParams): Promise<User> {
  const existing = await findUserByEmail({email: params.email});
  if (existing) {
    throw new EmailTakenError(params.email);
  }

  const hashedPassword = await hashPassword({password: params.password});
  const user = await createDbUser({
    email: params.email,
    hashedPassword,
    name: params.name ?? null,
  });

  if (!params.verified) return user;

  const verified = await markEmailVerified({userId: user.id});
  if (!verified) {
    throw new UserNotFoundError(user.id);
  }

  return verified;
}

export interface LoginParams {
  email: string;
  password: string;
}

export interface LoginResult {
  token: string;
  refreshToken: string;
  user: User;
}

export async function login(params: LoginParams): Promise<LoginResult> {
  const user = await findUserByEmail({email: params.email});

  if (!user) {
    await verifyPassword({password: params.password, hash: await getDummyHash()});
    throw new InvalidCredentialsError();
  }

  const ok = await verifyPassword({password: params.password, hash: user.hashedPassword});
  if (!ok || user.status !== 'active') {
    throw new InvalidCredentialsError();
  }

  if (user.emailVerifiedAt === null) {
    throw new EmailNotVerifiedError();
  }

  const token = await signAccessToken(user);
  const refreshToken = await createRefreshSession(user);

  return {token, refreshToken, user};
}

export interface CreateSessionForUserParams {
  userId?: string | undefined;
  email?: string | undefined;
}

export async function createSessionForUser(
  params: CreateSessionForUserParams,
): Promise<LoginResult> {
  const user = params.userId
    ? await findUserById({id: params.userId})
    : params.email
      ? await findUserByEmail({email: params.email})
      : undefined;

  if (!user) {
    throw new UserNotFoundError(params.userId ?? params.email ?? 'unknown');
  }
  if (user.emailVerifiedAt === null) {
    throw new EmailNotVerifiedError();
  }
  if (user.status !== 'active') {
    throw new InvalidCredentialsError();
  }

  const token = await signAccessToken(user);
  const refreshToken = await createRefreshSession(user);

  return {token, refreshToken, user};
}

export interface RefreshAccessTokenResult {
  token: string;
  refreshToken: string;
  user: User;
}

export async function refreshAccessToken(params: {
  refreshToken: string;
}): Promise<RefreshAccessTokenResult> {
  const currentHashedToken = hashOpaqueToken(params.refreshToken);
  const current = await findActiveRefreshTokenByHash({hashedToken: currentHashedToken});
  if (!current) {
    throw new TokenInvalidError('Refresh token is invalid or expired');
  }

  const user = await findUserById({id: current.userId});
  if (!user || user.status !== 'active') {
    await revokeRefreshTokenByHash({hashedToken: currentHashedToken});
    throw new TokenInvalidError('Refresh token is invalid or expired');
  }

  const nextRefreshToken = generateOpaqueToken('refreshToken');
  const rotated = await rotateActiveRefreshToken({
    id: current.id,
    currentHashedToken,
    nextHashedToken: hashOpaqueToken(nextRefreshToken),
    expiresAt: daysFromNow(config.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS),
  });
  if (!rotated) {
    throw new TokenInvalidError('Refresh token is invalid or expired');
  }

  const token = await signAccessToken(user);
  return {token, refreshToken: nextRefreshToken, user};
}

export interface ConfirmEmailVerificationResult {
  token: string;
  refreshToken: string;
  user: User;
}

export async function confirmEmailVerification(params: {
  token: string;
}): Promise<ConfirmEmailVerificationResult> {
  const consumed = await consumeEmailVerification({hashedToken: hashOpaqueToken(params.token)});
  if (!consumed) {
    throw new TokenInvalidError('Verification token is invalid or expired');
  }

  const user = await markEmailVerified({userId: consumed.userId});
  if (!user || user.status !== 'active') {
    throw new TokenInvalidError('Verification token is invalid or expired');
  }

  const token = await signAccessToken(user);
  const refreshToken = await createRefreshSession(user);

  return {token, refreshToken, user};
}

export async function resendEmailVerification(params: {email: string}): Promise<void> {
  const user = await findUserByEmail({email: params.email});
  if (!user || user.status !== 'active' || user.emailVerifiedAt !== null) {
    return;
  }

  await createAndSendEmailVerification(user);
}

export async function requestPasswordReset(params: {email: string}): Promise<void> {
  const user = await findUserByEmail({email: params.email});
  if (!user || user.status !== 'active') {
    return;
  }

  const rawToken = generateOpaqueToken('passwordReset');
  await createPasswordReset({
    userId: user.id,
    hashedToken: hashOpaqueToken(rawToken),
    expiresAt: hoursFromNow(RESET_TTL_HOURS),
  });

  const link = `${config.CLIENT_BASE_URL}/auth/reset?token=${rawToken}`;
  await mailer.send({
    to: user.email,
    subject: 'Reset your password',
    text: `Click to reset your password: ${link}`,
    html: `<p>Click to reset your password: <a href="${link}">${link}</a></p>`,
  });
}

export interface ConfirmPasswordResetResult {
  token: string;
  refreshToken: string;
  user: User;
}

export async function confirmPasswordReset(params: {
  token: string;
  newPassword: string;
}): Promise<ConfirmPasswordResetResult> {
  const consumed = await consumePasswordReset({hashedToken: hashOpaqueToken(params.token)});
  if (!consumed) {
    throw new TokenInvalidError('Reset token is invalid or expired');
  }

  const hashedPassword = await hashPassword({password: params.newPassword});
  const user = await updateUserPassword({userId: consumed.userId, hashedPassword});
  if (!user || user.status !== 'active') {
    throw new TokenInvalidError('Reset token is invalid or expired');
  }

  await revokeRefreshTokensForUser({userId: consumed.userId});

  const token = await signAccessToken(user);
  const refreshToken = await createRefreshSession(user);

  return {token, refreshToken, user};
}

export async function changePassword(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  refreshToken?: string | undefined;
}): Promise<void> {
  const user = await findUserById({id: params.userId});
  if (!user) {
    throw new UserNotFoundError(params.userId);
  }

  const ok = await verifyPassword({
    password: params.currentPassword,
    hash: user.hashedPassword,
  });
  if (!ok) {
    throw new InvalidCredentialsError();
  }

  const hashedPassword = await hashPassword({password: params.newPassword});
  const currentRefreshSession = params.refreshToken
    ? await findActiveRefreshTokenByHash({hashedToken: hashOpaqueToken(params.refreshToken)})
    : undefined;
  const exceptRefreshTokenId =
    currentRefreshSession?.userId === user.id ? currentRefreshSession.id : undefined;

  await updateUserPassword({userId: user.id, hashedPassword});
  await revokeRefreshTokensForUser({userId: user.id, exceptRefreshTokenId});
}

export async function logout(params: {refreshToken?: string | undefined}): Promise<void> {
  if (!params.refreshToken) return;
  await revokeRefreshTokenByHash({hashedToken: hashOpaqueToken(params.refreshToken)});
}

export interface GetCurrentUserResult {
  user: User;
}

export async function getCurrentUser(params: {userId: string}): Promise<GetCurrentUserResult> {
  const user = await findUserById({id: params.userId});
  if (!user) {
    throw new UserNotFoundError(params.userId);
  }

  return {user};
}
