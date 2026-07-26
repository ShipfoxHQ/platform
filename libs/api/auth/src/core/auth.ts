import {emailSchema} from '@shipfox/api-auth-dto';
import {
  confirmEmailChallenge,
  consumeEmailChallengeProof,
  createEmailChallenge,
  resendEmailChallenge,
} from '@shipfox/api-email-challenges';
import {
  type WorkspacesInterModuleClient,
  workspacesInterModuleContract,
} from '@shipfox/api-workspaces-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {userAccessTokenKey} from '@shipfox/node-auth-root-key';
import {generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {config} from '#config.js';
import {consumePasswordReset, createPasswordReset} from '#db/password-resets.js';
import {
  createRefreshToken,
  findActiveRefreshTokenByHash,
  findRefreshTokenByHash,
  revokeRefreshSession,
  revokeRefreshTokensForUser,
  rotateRefreshToken,
} from '#db/refresh-tokens.js';
import {
  createUser as createDbUser,
  findUserByEmail,
  findUserById,
  markEmailVerified,
  provisionUser as provisionDbUser,
  updateUserPassword,
} from '#db/users.js';
import {type AuthTokenRefreshOutcome, recordTokenRefreshed} from '#metrics/index.js';
import type {RefreshToken} from './entities/refresh-token.js';
import type {User} from './entities/user.js';
import {
  AuthDependencyUnavailableError,
  EmailNotVerifiedError,
  EmailTakenError,
  InvalidCredentialsError,
  InvitationEmailMismatchError,
  TokenAlreadyUsedError,
  TokenExpiredError,
  TokenInvalidError,
  UserNotFoundError,
} from './errors.js';
import {signUserToken} from './jwt.js';
import {hashPassword, verifyPassword} from './password.js';
import type {SignupPolicy} from './ports.js';

const RESET_TTL_HOURS = 1;
const PASSWORD_VERIFICATION_PURPOSE = 'password-verification';

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

function recordRefreshOutcome(outcome: AuthTokenRefreshOutcome): void {
  recordTokenRefreshed(outcome);
}

async function signAccessToken(
  user: User,
  workspaces: WorkspacesInterModuleClient,
  refreshSessionId: string,
): Promise<string> {
  const memberships = await workspaces
    .listMembershipsForTokenClaims({userId: user.id})
    .catch((error: unknown) => {
      throw new AuthDependencyUnavailableError('workspaces', error);
    });
  return await signUserToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    memberships: memberships.memberships,
    refreshSessionId,
    secret: userAccessTokenKey(),
    expiresIn: config.AUTH_JWT_EXPIRES_IN,
  });
}

function isWithinRotationGrace(refreshToken: RefreshToken): boolean {
  if (!refreshToken.rotatedAt) return false;
  const graceMs = config.AUTH_REFRESH_ROTATION_GRACE_SECONDS * 1000;
  return Date.now() - refreshToken.rotatedAt.getTime() <= graceMs;
}

async function createRefreshSession(
  user: User,
  refreshSessionId: string,
): Promise<{refreshToken: string; refreshSessionId: string}> {
  const refreshToken = generateOpaqueToken('refreshToken');
  const session = await createRefreshToken({
    sessionId: refreshSessionId,
    userId: user.id,
    hashedToken: hashOpaqueToken(refreshToken),
    expiresAt: daysFromNow(config.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS),
  });
  return {refreshToken, refreshSessionId: session.sessionId};
}

async function createSessionTokens(
  user: User,
  workspaces: WorkspacesInterModuleClient,
): Promise<{token: string; refreshToken: string}> {
  const refreshSessionId = crypto.randomUUID();
  const token = await signAccessToken(user, workspaces, refreshSessionId);
  const {refreshToken} = await createRefreshSession(user, refreshSessionId);
  return {token, refreshToken};
}

function passwordResetLink(rawToken: string): string {
  return `${config.CLIENT_BASE_URL}/auth/reset?token=${rawToken}`;
}

function invitationErrorFromKnownError(
  error: unknown,
  method: 'preflightInvitationAcceptance' | 'acceptInvitation',
): Error {
  const contractMethod = workspacesInterModuleContract.methods[method];
  if (!isInterModuleKnownError(contractMethod, error)) return error as Error;

  if (error.code === 'invitation-token-invalid')
    return new TokenInvalidError('Invitation token is invalid');
  if (error.code === 'invitation-token-used') return new TokenAlreadyUsedError();
  if (error.code === 'invitation-token-expired') return new TokenExpiredError();
  return new InvitationEmailMismatchError();
}

function invitationErrorMessage(
  code:
    | 'invitation-token-invalid'
    | 'invitation-token-used'
    | 'invitation-token-expired'
    | 'invitation-email-mismatch',
): string {
  if (code === 'invitation-token-invalid') return 'Invitation token is invalid';
  if (code === 'invitation-token-used') return 'Invitation has already been accepted';
  if (code === 'invitation-token-expired') return 'Invitation has expired';
  return 'Signup email does not match the invitation';
}

export interface SignupParams {
  email: string;
  password: string;
  name?: string | undefined;
  signupPolicy?: SignupPolicy | undefined;
}

export interface ProvisionUserParams {
  email: string;
  name?: string | null | undefined;
  signupPolicy?: SignupPolicy | undefined;
}

/**
 * Creates a verified, password-less user for an external identity provider.
 * Existing users are returned unchanged, including their password and profile.
 */
export async function provisionUser(params: ProvisionUserParams): Promise<User> {
  return await provisionDbUser({
    email: emailSchema.parse(params.email),
    name: params.name ?? null,
  });
}

export type SignupResult = User & {
  emailChallenge: {id: string; nextResendAvailableAt: Date};
};

export async function signup(params: SignupParams & {sourceIp?: string}): Promise<SignupResult> {
  const existing = await findUserByEmail({email: params.email});
  if (existing) {
    const canResumeVerification =
      existing.status === 'active' &&
      existing.emailVerifiedAt === null &&
      existing.hashedPassword !== null &&
      (await verifyPassword({password: params.password, hash: existing.hashedPassword}));
    if (canResumeVerification) {
      const emailChallenge = await createEmailChallenge({
        email: existing.email,
        purpose: PASSWORD_VERIFICATION_PURPOSE,
        continuation: existing.id,
        idempotencyKey: existing.id,
        sourceIp: params.sourceIp ?? '0.0.0.0',
      });
      return {...existing, emailChallenge};
    }
    throw new EmailTakenError(params.email);
  }

  const hashedPassword = await hashPassword({password: params.password});
  const user = await createDbUser({
    email: params.email,
    hashedPassword,
    name: params.name ?? null,
    signedUp: {viaInvitation: false},
  });

  const emailChallenge = await createEmailChallenge({
    email: user.email,
    purpose: PASSWORD_VERIFICATION_PURPOSE,
    continuation: user.id,
    idempotencyKey: user.id,
    sourceIp: params.sourceIp ?? '0.0.0.0',
  });

  return {...user, emailChallenge};
}

export interface SignupWithInvitationParams extends SignupParams {
  invitationToken: string;
  workspaces: WorkspacesInterModuleClient;
}

export interface SignupWithInvitationResult extends LoginResult {
  membership: {id: string; userId: string; workspaceId: string} | null;
  acceptError?: {code: string; message: string};
}

export async function signupWithInvitation(
  params: SignupWithInvitationParams,
): Promise<SignupWithInvitationResult> {
  // Step 1: Pre-validate the invitation BEFORE any user write so an invalid
  // token never produces an orphan user. Re-validation happens again inside
  // acceptWorkspaceInvitation (race-safe) after the user is created.
  try {
    await params.workspaces.preflightInvitationAcceptance({
      token: params.invitationToken,
      email: params.email,
    });
  } catch (error) {
    throw invitationErrorFromKnownError(error, 'preflightInvitationAcceptance');
  }

  // Step 2: Create the user as verified. The invitation email is the proof of
  // ownership, and this avoids a second auth-table write just to mark verified.
  const existing = await findUserByEmail({email: params.email});
  if (existing) {
    throw new EmailTakenError(params.email);
  }
  const hashedPassword = await hashPassword({password: params.password});
  const user = await createDbUser({
    email: params.email,
    hashedPassword,
    name: params.name ?? null,
    emailVerifiedAt: new Date(),
    signedUp: {viaInvitation: true},
  });

  // Step 3: Accept the invitation through the workspaces module boundary.
  // This is intentionally not one database transaction with auth; treat it like
  // calling another service. If it fails after user creation, return a verified
  // signed-in user and an explicit retryable accept error.
  let membership: SignupWithInvitationResult['membership'] = null;
  let acceptError: SignupWithInvitationResult['acceptError'];
  try {
    const result = await params.workspaces.acceptInvitation({
      token: params.invitationToken,
      userId: user.id,
      email: user.email,
      name: user.name,
    });
    membership = {
      id: result.membership.id,
      userId: result.membership.userId,
      workspaceId: result.membership.workspaceId,
    };
  } catch (error) {
    if (isInterModuleKnownError(workspacesInterModuleContract.methods.acceptInvitation, error)) {
      acceptError = {code: error.code, message: invitationErrorMessage(error.code)};
    } else {
      acceptError = {
        code: 'AcceptFailed',
        message: 'Could not accept the invitation; please retry from the invite link.',
      };
    }
  }

  // Step 4: Issue session. signAccessToken reads memberships through the
  // workspaces module API, so a successful accept is reflected in the JWT.
  const {token, refreshToken} = await createSessionTokens(user, params.workspaces);

  if (acceptError) {
    return {token, refreshToken, user, membership, acceptError};
  }
  return {token, refreshToken, user, membership};
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
    emailVerifiedAt: params.verified ? new Date() : null,
  });

  return user;
}

export interface LoginParams {
  email: string;
  password: string;
  workspaces: WorkspacesInterModuleClient;
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

  const hasPassword = user.hashedPassword !== null;
  const ok = await verifyPassword({
    password: params.password,
    hash: user.hashedPassword ?? (await getDummyHash()),
  });
  if (!hasPassword || !ok || user.status !== 'active') {
    throw new InvalidCredentialsError();
  }

  if (user.emailVerifiedAt === null) {
    throw new EmailNotVerifiedError();
  }

  const {token, refreshToken} = await createSessionTokens(user, params.workspaces);

  return {token, refreshToken, user};
}

export interface CreateSessionForUserParams {
  userId?: string | undefined;
  email?: string | undefined;
  workspaces: WorkspacesInterModuleClient;
}

export interface CreateSessionForUserResult {
  token: string;
  refreshToken: string;
  user: User;
}

export type CreateSessionForUserError =
  | AuthDependencyUnavailableError
  | EmailNotVerifiedError
  | InvalidCredentialsError
  | UserNotFoundError;

export async function createSessionForUser(
  params: CreateSessionForUserParams,
): Promise<CreateSessionForUserResult> {
  const user = params.userId
    ? await findUserById({id: params.userId})
    : params.email
      ? await findUserByEmail({email: emailSchema.parse(params.email)})
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

  const {token, refreshToken} = await createSessionTokens(user, params.workspaces);

  return {token, refreshToken, user};
}

export interface RefreshAccessTokenResult {
  token: string;
  /** Undefined on a grace-window hit: keep the existing cookie instead of rotating it. */
  refreshToken: string | undefined;
  user: User;
}

export async function refreshAccessToken(params: {
  refreshToken: string;
  workspaces: WorkspacesInterModuleClient;
}): Promise<RefreshAccessTokenResult> {
  const currentHashedToken = hashOpaqueToken(params.refreshToken);
  const current = await findRefreshTokenByHash({hashedToken: currentHashedToken});
  if (!current) {
    recordRefreshOutcome('rejected');
    throw new TokenInvalidError('Refresh token is invalid or expired');
  }

  const user = await findUserById({id: current.userId});
  if (user?.status !== 'active') {
    await revokeRefreshSession({sessionId: current.sessionId, userId: current.userId});
    recordRefreshOutcome('rejected');
    throw new TokenInvalidError('Refresh token is invalid or expired');
  }

  // Within the grace window a rotated token means a concurrent refresh (e.g. a
  // second tab); past it, reuse of a retired token means a compromised session.
  if (current.rotatedAt) {
    if (isWithinRotationGrace(current)) {
      const token = await signAccessToken(user, params.workspaces, current.sessionId);
      recordRefreshOutcome('grace');
      return {token, refreshToken: undefined, user};
    }
    await revokeRefreshTokensForUser({userId: user.id});
    recordRefreshOutcome('rejected');
    throw new TokenInvalidError('Refresh token reused after rotation');
  }

  // Losing the CAS requires a state check: another request may have rotated,
  // revoked, or expired the token before this refresh could claim it.
  const nextRefreshToken = generateOpaqueToken('refreshToken');
  const rotated = await rotateRefreshToken({
    id: current.id,
    currentHashedToken,
    nextHashedToken: hashOpaqueToken(nextRefreshToken),
    expiresAt: daysFromNow(config.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS),
  });
  if (!rotated) {
    const latest = await findRefreshTokenByHash({hashedToken: currentHashedToken});
    if (!latest || !isWithinRotationGrace(latest)) {
      recordRefreshOutcome('rejected');
      throw new TokenInvalidError('Refresh token is invalid or expired');
    }
    const token = await signAccessToken(user, params.workspaces, latest.sessionId);
    recordRefreshOutcome('grace');
    return {token, refreshToken: undefined, user};
  }

  const token = await signAccessToken(user, params.workspaces, current.sessionId);
  recordRefreshOutcome('rotated');
  return {token, refreshToken: nextRefreshToken, user};
}

export interface ConfirmEmailVerificationResult {
  token: string;
  refreshToken: string;
  user: User;
}

export interface ResendEmailVerificationResult {
  nextResendAvailableAt: Date;
}

export async function confirmEmailVerification(params: {
  email: string;
  challengeId: string;
  code: string;
  workspaces: WorkspacesInterModuleClient;
}): Promise<ConfirmEmailVerificationResult> {
  const user = await findUserByEmail({email: emailSchema.parse(params.email)});
  if (!user) throw new TokenInvalidError('Verification code is invalid or expired');
  await confirmEmailChallenge({id: params.challengeId, code: params.code, continuation: user.id});
  await consumeEmailChallengeProof({
    id: params.challengeId,
    purpose: PASSWORD_VERIFICATION_PURPOSE,
    continuation: user.id,
  });

  const verifiedUser = await markEmailVerified({userId: user.id});
  if (verifiedUser?.status !== 'active') {
    throw new TokenInvalidError('Verification code is invalid or expired');
  }

  const {token, refreshToken} = await createSessionTokens(verifiedUser, params.workspaces);

  return {token, refreshToken, user: verifiedUser};
}

export async function resendEmailVerification(params: {
  email: string;
  challengeId: string;
  sourceIp: string;
}): Promise<ResendEmailVerificationResult> {
  const user = await findUserByEmail({email: emailSchema.parse(params.email)});
  if (!user || user.emailVerifiedAt || user.status !== 'active') {
    return {nextResendAvailableAt: new Date()};
  }
  const result = await resendEmailChallenge({
    id: params.challengeId,
    continuation: user.id,
    sourceIp: params.sourceIp,
  });

  return {nextResendAvailableAt: result.nextResendAvailableAt};
}

export async function requestPasswordReset(params: {email: string}): Promise<void> {
  const user = await findUserByEmail({email: params.email});
  if (user?.status !== 'active' || user.hashedPassword === null) {
    return;
  }

  const rawToken = generateOpaqueToken('passwordReset');
  await createPasswordReset({
    userId: user.id,
    hashedToken: hashOpaqueToken(rawToken),
    expiresAt: hoursFromNow(RESET_TTL_HOURS),
    sendEmail: {
      email: user.email,
      resetLink: passwordResetLink(rawToken),
      expiresInHours: RESET_TTL_HOURS,
    },
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
  workspaces: WorkspacesInterModuleClient;
}): Promise<ConfirmPasswordResetResult> {
  const consumed = await consumePasswordReset({hashedToken: hashOpaqueToken(params.token)});
  if (!consumed) {
    throw new TokenInvalidError('Reset token is invalid or expired');
  }

  const existingUser = await findUserById({id: consumed.userId});
  if (existingUser?.status !== 'active' || existingUser.hashedPassword === null) {
    throw new TokenInvalidError('Reset token is invalid or expired');
  }

  const hashedPassword = await hashPassword({password: params.newPassword});
  const user = await updateUserPassword({userId: consumed.userId, hashedPassword});
  if (user?.status !== 'active') {
    throw new TokenInvalidError('Reset token is invalid or expired');
  }

  await revokeRefreshTokensForUser({userId: consumed.userId});

  const {token, refreshToken} = await createSessionTokens(user, params.workspaces);

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

  const hasPassword = user.hashedPassword !== null;
  const ok = await verifyPassword({
    password: params.currentPassword,
    hash: user.hashedPassword ?? (await getDummyHash()),
  });
  if (!hasPassword || !ok) {
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
  const refreshToken = await findRefreshTokenByHash({
    hashedToken: hashOpaqueToken(params.refreshToken),
  });
  if (!refreshToken) return;
  await revokeRefreshSession({sessionId: refreshToken.sessionId, userId: refreshToken.userId});
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
