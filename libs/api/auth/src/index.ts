import {
  AUTH_PASSWORD_RESET_SEND_REQUESTED,
  type AuthEventMap,
  authEventSchemas,
} from '@shipfox/api-auth-dto';
import {administrationActionEventSchemas} from '@shipfox/api-common-dto';
import type {ShipfoxModule} from '@shipfox/node-module';
import {subscriberFactory} from '@shipfox/node-module';
import {config} from '#config.js';
import type {SignupPolicy} from '#core/ports.js';
import {createEnvironmentSignupPolicy} from '#core/signup-policy.js';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {authOutbox} from '#db/schema/outbox.js';
import {createJwtAuthMethod} from '#presentation/auth/jwt-auth.js';
import {createLeaseTokenAuthMethod} from '#presentation/auth/lease-token-auth.js';
import {createRunnerSessionAuthMethod} from '#presentation/auth/runner-session-auth.js';
import {createAuthE2eRoutes} from '#presentation/e2eRoutes/index.js';
import {createAuthInterModulePresentation} from '#presentation/inter-module.js';
import {
  administrationBootstrapRoutes,
  administrationRoutes,
  administrationUserRoutes,
} from '#presentation/routes/administration.js';
import {buildAuthRoutes} from '#presentation/routes/index.js';
import {onPasswordResetSendRequested} from '#presentation/subscribers/index.js';
import {passwordLoginMethods} from './login-methods.js';

const authPublisherEventSchemas = {...authEventSchemas, ...administrationActionEventSchemas};

export type {AdminRole, JobLeaseTokenClaims, RunnerSessionTokenClaims} from '@shipfox/api-auth-dto';
export {
  ADMIN_ROLES,
  getCurrentAdminRole,
  hasMinimumAdminRole,
  highestAdminRole,
  requireAdminRole,
  revokeAdminGrant,
} from '#core/admin-role.js';
export {
  bootstrapFirstAdminOwner,
  grantAdministratorRole,
  reactivateAdministratorUser,
  revokeAdministratorGrant,
  revokeAdministratorUserSessions,
  suspendAdministratorUser,
} from '#core/administration.js';
export type {
  CreateSessionForUserError,
  CreateSessionForUserParams,
  CreateSessionForUserResult,
  ProvisionUserParams,
} from '#core/auth.js';
export {createSessionForUser, provisionUser} from '#core/auth.js';
export type {EmailOwner, FindUserByEmailParams} from '#core/email-owner.js';
export {findUserByEmail} from '#core/email-owner.js';
export type {AdminGrant} from '#core/entities/admin-grant.js';
export type {User, UserStatus} from '#core/entities/user.js';
export {
  AdminBootstrapClosedError,
  AdminGrantAlreadyExistsError,
  AdminGrantNotFoundError,
  AdminIdempotencyKeyReuseError,
  AdminRoleRequiredError,
  AuthDependencyUnavailableError,
  EmailNotVerifiedError,
  InvalidAdminBootstrapTokenError,
  InvalidCredentialsError,
  LastAdminOwnerError,
  SignupNotAllowedError,
  UserNotFoundError,
} from '#core/errors.js';
export {
  issueJobLeaseToken,
  jobLeaseParamsFrom,
  verifyJobLeaseToken,
} from '#core/job-lease-token.js';
export type {SignupDenialMessageFormat, SignupPolicy} from '#core/ports.js';
export {
  issueRunnerSessionToken,
  verifyRunnerSessionToken,
} from '#core/runner-session-token.js';
export {
  createEnvironmentSignupPolicy,
  DEFAULT_SIGNUP_NOT_ALLOWED_MESSAGE,
} from '#core/signup-policy.js';
export {
  type AuthenticatedSessionContext,
  createJwtAuthMethod,
  getAuthenticatedSessionContext,
  type RefreshSessionId,
  type UserId,
} from '#presentation/auth/jwt-auth.js';
export {createLeaseTokenAuthMethod} from '#presentation/auth/lease-token-auth.js';
export {
  authCookiePlugin,
  clearRefreshTokenCookie,
  getRefreshTokenCookie,
  setRefreshTokenCookie,
} from '#presentation/auth/refresh-cookie.js';
export {createRunnerSessionAuthMethod} from '#presentation/auth/runner-session-auth.js';

const subscriber = subscriberFactory<AuthEventMap>();

export interface CreateAuthModuleOptions {
  workspaces: import('@shipfox/api-workspaces-dto/inter-module').WorkspacesInterModuleClient;
  signupPolicy?: SignupPolicy;
}

export function createAuthModule({
  workspaces,
  signupPolicy = createEnvironmentSignupPolicy(),
}: CreateAuthModuleOptions): ShipfoxModule {
  return {
    name: 'auth',
    database: {db, migrationsPath, databaseNamespace: 'auth'},
    auth: [createJwtAuthMethod(), createLeaseTokenAuthMethod(), createRunnerSessionAuthMethod()],
    loginMethods: passwordLoginMethods(config.AUTH_PASSWORD_ENABLED),
    routes: [
      buildAuthRoutes(config.AUTH_PASSWORD_ENABLED, workspaces, signupPolicy),
      administrationBootstrapRoutes,
      administrationRoutes,
      administrationUserRoutes,
    ],
    e2eRoutes: [createAuthE2eRoutes(workspaces)],
    publishers: [{name: 'auth', table: authOutbox, db, eventSchemas: authPublisherEventSchemas}],
    subscribers: [subscriber(AUTH_PASSWORD_RESET_SEND_REQUESTED, onPasswordResetSendRequested)],
    interModulePresentations: [createAuthInterModulePresentation()],
  };
}
