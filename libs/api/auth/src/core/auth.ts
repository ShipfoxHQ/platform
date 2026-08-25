import {type AdminRole, emailSchema} from '@shipfox/api-auth-dto';
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
import {durationToSeconds} from '@shipfox/node-jwt';
import {generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {config} from '#config.js';
import {consumePasswordReset, createPasswordReset} from '#db/password-resets.js';
import {
  createRefreshTokenForActiveUser,
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
import {getCurrentAdminRole} from './admin-role.js';
import type {RefreshToken} from './entities/refresh-token.js';
import type {User} from './entities/user.js';
import {
  AuthDependencyUnavailableError,
  EmailNotVerifiedError,
  EmailTakenError,
  ImpersonationDisabledError,
  InvalidCredentialsError,
  InvitationEmailMismatchError,
  SignupNotAllowedError,
  TokenAlreadyUsedError,
  TokenExpiredError,
  TokenInvalidError,
  UserNotFoundError,
} from './errors.js';
import {signUserToken, type TokenMembership, verifyUserToken} from './jwt.js';
import {hashPassword, verifyPassword} from './password.js';
import type {SignupPolicy} from './ports.js';
import {createEnvironmentSignupPolicy} from './signup-policy.js';

const RESET_TTL_HOURS = 1;
const PASSWORD_VERIFICATION_PURPOSE = 'password-verification';
const DEFAULT_SIGNUP_NOT_ALLOWED_MESSAGE =
  'This Shipfox deployment does not accept new accounts right now.';

const defaultSignupPolicy: SignupPolicy = createEnvironmentSignupPolicy();

async function assertSignupAllowed(params: {
  signupPolicy?: SignupPolicy | undefined;
  email: string;
  emailVerified: boolean;
  source: string;
}): Promise<void> {
  const result = await (params.signupPolicy ?? defaultSignupPolicy).isSignupAllowed({
    email: params.email,
    emailVerified: params.emailVerified,
    source: params.source,
  });

  if (!result.allowed) {
    throw new SignupNotAllowedError(
      result.message ?? DEFAULT_SIGNUP_NOT_ALLOWED_MESSAGE,
      result.format,
    );
  }
}

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

type TokenMemberships = TokenMembership[];

async function loadTokenMemberships(
  userId: string,
  workspaces: WorkspacesInterModuleClient,
): Promise<TokenMemberships> {
  const memberships = await workspaces
    .listMembershipsForTokenClaims({userId})
    .catch((error: unknown) => {
      throw new AuthDependencyUnavailableError('workspaces', error);
    });
  return memberships.memberships;
}

async function signAccessToken(
  user: User,
  memberships: TokenMemberships,
  refreshSessionId: string,
): Promise<string> {
  return await signUserToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    memberships,
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
  const session = await createRefreshTokenForActiveUser({
    sessionId: refreshSessionId,
    userId: user.id,
    hashedToken: hashOpaqueToken(refreshToken),
    expiresAt: daysFromNow(config.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS),
  });
  if (!session) throw new InvalidCredentialsError();
  return {refreshToken, refreshSessionId: session.sessionId};
}

async function createSessionTokens(
  user: User,
  workspaces: WorkspacesInterModuleClient,
): Promise<{token: string; refreshToken: string; adminRole: AdminRole | null}> {
  const refreshSessionId = crypto.randomUUID();
  const memberships = await loadTokenMemberships(user.id, workspaces);
  const token = await signAccessToken(user, memberships, refreshSessionId);
  const adminRole = await getCurrentAdminRole({userId: user.id});
  const {refreshToken} = await createRefreshSession(user, refreshSessionId);
  return {token, refreshToken, adminRole};
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
  const email = emailSchema.parse(params.email);
  const existing = await findUserByEmail({email});
  if (existing) return existing;

  await assertSignupAllowed({
    signupPolicy: params.signupPolicy,
    email,
    emailVerified: true,
    source: 'external-identity',
  });

  return await provisionDbUser({
    email,
    name: params.name ?? null,
  });
}

export type SignupResult = User & {
  emailChallenge: {id: string; nextResendAvailableAt: Date};
};

export async function signup(params: SignupParams & {sourceIp?: string}): Promise<SignupResult> {
  const email = emailSchema.parse(params.email);
  const existing = await findUserByEmail({email});
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
    throw new EmailTakenError(email);
  }

  await assertSignupAllowed({
    signupPolicy: params.signupPolicy,
    email,
    emailVerified: false,
    source: 'password',
  });

  const hashedPassword = await hashPassword({password: params.password});
  const user = await createDbUser({
    email,
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

  // Step 4: Issue session. createSessionTokens reads memberships through the
  // workspaces module API, so a successful accept is reflected in the JWT.
  const {token, refreshToken, adminRole} = await createSessionTokens(user, params.workspaces);

  if (acceptError) {
    return {token, refreshToken, user, membership, acceptError, adminRole};
  }
  return {token, refreshToken, user, membership, adminRole};
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
  adminRole: AdminRole | null;
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

  const {token, refreshToken, adminRole} = await createSessionTokens(user, params.workspaces);

  return {token, refreshToken, user, adminRole};
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
  adminRole: AdminRole | null;
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

  const {token, refreshToken, adminRole} = await createSessionTokens(user, params.workspaces);

  return {token, refreshToken, user, adminRole};
}

/**
 * Cap for impersonated session tokens: the TTL is min(`AUTH_JWT_EXPIRES_IN`,
 * this), so an impersonated window can never outlive 15 minutes no matter how
 * the deployment configures ordinary access tokens.
 */
export const IMPERSONATION_MAX_TTL_SECONDS = 15 * 60;

export interface CreateImpersonatedSessionTokenParams {
  targetUserId: string;
  /** The administrator the token is minted for; signed into the `impersonatorId` claim. */
  impersonatorId: string;
  workspaces: WorkspacesInterModuleClient;
  /**
   * Re-sign lifetime override used by an idempotent replay: the remaining
   * lifetime to the stored `expires_at`, so a replay never extends the window.
   * Defaults to min(`AUTH_JWT_EXPIRES_IN`, 15 minutes).
   */
  expiresIn?: string | undefined;
}

export interface CreateImpersonatedSessionTokenResult {
  token: string;
  expiresAt: Date;
  user: User;
}

function impersonationTtlSeconds(): number {
  const configuredSeconds = durationToSeconds(config.AUTH_JWT_EXPIRES_IN);
  const ttlSeconds = Math.min(configuredSeconds, IMPERSONATION_MAX_TTL_SECONDS);
  if (ttlSeconds <= 0) {
    throw new TypeError(
      `AUTH_JWT_EXPIRES_IN must be a valid duration of at least 1 second, got ${config.AUTH_JWT_EXPIRES_IN}`,
    );
  }
  return ttlSeconds;
}

/**
 * Mints an access-token-only impersonated session for a target user: the same
 * eligibility as login (active account, verified email), the target's real
 * membership claims, a capped TTL, the `impersonatorId` claim, and **no**
 * `refreshSessionId`. It creates no refresh session and sets no cookie, so
 * nothing persisted can resurrect the session after the token window.
 */
export async function createImpersonatedSessionToken(
  params: CreateImpersonatedSessionTokenParams,
): Promise<CreateImpersonatedSessionTokenResult> {
  // Rule 1 lives in the mint primitive as well as the command entry, so the
  // exported package API can never bypass the kill switch: the flag is a
  // configuration read that also holds on the in-transaction replay path.
  if (!config.AUTH_IMPERSONATION_ENABLED) throw new ImpersonationDisabledError();

  const user = await findUserById({id: params.targetUserId});
  if (!user) {
    throw new UserNotFoundError(params.targetUserId);
  }
  if (user.emailVerifiedAt === null) {
    throw new EmailNotVerifiedError();
  }
  if (user.status !== 'active') {
    throw new InvalidCredentialsError();
  }

  const memberships = await loadTokenMemberships(user.id, params.workspaces);
  const ttlSeconds =
    params.expiresIn === undefined
      ? impersonationTtlSeconds()
      : Math.min(durationToSeconds(params.expiresIn), IMPERSONATION_MAX_TTL_SECONDS);
  if (ttlSeconds <= 0) {
    throw new TypeError(
      `Impersonation token TTL must be at least 1 second, got ${params.expiresIn}`,
    );
  }

  const token = await signUserToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    memberships,
    impersonatorId: params.impersonatorId,
    secret: userAccessTokenKey(),
    expiresIn: `${ttlSeconds}s`,
  });

  // The advertised expiry is the token's actual signed `exp`, never a
  // clock-derived estimate: the signer stamps `iat`/`exp` in whole seconds, so
  // `Date.now() + ttl` could drift up to a second from the signed claims in
  // either direction. Deriving `expiresAt` from the signed token keeps the
  // response, the stored command result, and the bearer token exactly aligned,
  // which is what lets a replay re-sign with a TTL that never extends the
  // window (`exp` of the re-signed token is at most the original `exp`).
  const claims = await verifyUserToken({token, secret: userAccessTokenKey()});
  return {token, expiresAt: new Date(claims.exp * 1000), user};
}

export interface RefreshAccessTokenResult {
  token: string;
  /** Undefined on a grace-window hit: keep the existing cookie instead of rotating it. */
  refreshToken: string | undefined;
  user: User;
  adminRole: AdminRole | null;
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
  const adminRole = await getCurrentAdminRole({userId: user.id});

  // Within the grace window a rotated token means a concurrent refresh (e.g. a
  // second tab); past it, reuse of a retired token means a compromised session.
  if (current.rotatedAt) {
    if (isWithinRotationGrace(current)) {
      const memberships = await loadTokenMemberships(user.id, params.workspaces);
      const token = await signAccessToken(user, memberships, current.sessionId);
      recordRefreshOutcome('grace');
      return {token, refreshToken: undefined, user, adminRole};
    }
    await revokeRefreshTokensForUser({userId: user.id});
    recordRefreshOutcome('rejected');
    throw new TokenInvalidError('Refresh token reused after rotation');
  }

  // Keep the external membership snapshot ahead of rotation so an outage
  // cannot retire a refresh token that the caller can still retry.
  const memberships = await loadTokenMemberships(user.id, params.workspaces);

  // Losing the CAS requires a state check: another request may have rotated,
  // revoked, or expired the token before this refresh could claim it.
  const nextRefreshToken = generateOpaqueToken('refreshToken');
  const rotated = await rotateRefreshToken({
    userId: current.userId,
    id: current.id,
    currentHashedToken,
    nextHashedToken: hashOpaqueToken(nextRefreshToken),
    expiresAt: daysFromNow(config.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS),
  });
  if (!rotated) {
    const latestUser = await findUserById({id: current.userId});
    if (latestUser?.status !== 'active') {
      recordRefreshOutcome('rejected');
      throw new TokenInvalidError('Refresh token is invalid or expired');
    }
    const latest = await findRefreshTokenByHash({hashedToken: currentHashedToken});
    if (!latest || !isWithinRotationGrace(latest)) {
      recordRefreshOutcome('rejected');
      throw new TokenInvalidError('Refresh token is invalid or expired');
    }
    const token = await signAccessToken(user, memberships, latest.sessionId);
    recordRefreshOutcome('grace');
    return {token, refreshToken: undefined, user, adminRole};
  }

  const token = await signAccessToken(user, memberships, current.sessionId);
  recordRefreshOutcome('rotated');
  return {token, refreshToken: nextRefreshToken, user, adminRole};
}

export interface ConfirmEmailVerificationResult {
  token: string;
  refreshToken: string;
  user: User;
  adminRole: AdminRole | null;
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

  const {token, refreshToken, adminRole} = await createSessionTokens(
    verifiedUser,
    params.workspaces,
  );

  return {token, refreshToken, user: verifiedUser, adminRole};
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
  adminRole: AdminRole | null;
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

  const {token, refreshToken, adminRole} = await createSessionTokens(user, params.workspaces);

  return {token, refreshToken, user, adminRole};
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
