import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
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
import {createAgentAccessAuthMethod} from '#presentation/auth/agent-access-auth.js';
import {createJwtAuthMethod} from '#presentation/auth/jwt-auth.js';
import {createLeaseTokenAuthMethod} from '#presentation/auth/lease-token-auth.js';
import {createRunnerSessionAuthMethod} from '#presentation/auth/runner-session-auth.js';
import {createAuthE2eRoutes} from '#presentation/e2eRoutes/index.js';
import {createAuthInterModulePresentation} from '#presentation/inter-module.js';
import {
  administrationBootstrapRoutes,
  administrationRoutes,
  createAdministrationUserRoutes,
} from '#presentation/routes/administration.js';
import {createAgentAccessManagementRoutes} from '#presentation/routes/agent-access.js';
import {buildAuthRoutes} from '#presentation/routes/index.js';
import {createOAuthAuthorizationRoutes, createOAuthRoutes} from '#presentation/routes/oauth.js';
import {onPasswordResetSendRequested} from '#presentation/subscribers/index.js';
import {createAuthMaintenanceActivities} from '#temporal/activities/index.js';
import {AUTH_AGENT_ACCESS_MAINTENANCE_TASK_QUEUE} from '#temporal/constants.js';
import {passwordLoginMethods} from './login-methods.js';

const authPublisherEventSchemas = {...authEventSchemas, ...administrationActionEventSchemas};
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

export type {
  AdminRole,
  AgentAccessTokenClaims,
  JobLeaseTokenClaims,
  RunnerSessionTokenClaims,
} from '@shipfox/api-auth-dto';
export {
  ADMIN_ROLES,
  getCurrentAdminRole,
  hasMinimumAdminRole,
  highestAdminRole,
  requireAdminRole,
  revokeAdminGrant,
} from '#core/admin-role.js';
export type {
  ListAdministratorUsersParams,
  ListAdministratorUsersResult,
} from '#core/administration.js';
export {
  bootstrapFirstAdminOwner,
  grantAdministratorRole,
  impersonateUser,
  listAdministratorUsers,
  reactivateAdministratorUser,
  revokeAdministratorGrant,
  revokeAdministratorUserSessions,
  suspendAdministratorUser,
} from '#core/administration.js';
export type {AgentGrantSummary} from '#core/agent-access.js';
export {
  listAgentGrants,
  revokeAgentGrant,
} from '#core/agent-access.js';
export type {IssueAgentAccessTokenParams} from '#core/agent-access-token.js';
export {
  AGENT_ACCESS_TOKEN_EXPIRES_IN,
  AGENT_ACCESS_TOKEN_EXPIRES_IN_SECONDS,
  issueAgentAccessToken,
  verifyAgentAccessToken,
} from '#core/agent-access-token.js';
export type {
  CreateImpersonatedSessionTokenParams,
  CreateImpersonatedSessionTokenResult,
  CreateSessionForUserError,
  CreateSessionForUserParams,
  CreateSessionForUserResult,
  ProvisionUserParams,
} from '#core/auth.js';
export {createImpersonatedSessionToken, createSessionForUser, provisionUser} from '#core/auth.js';
export type {
  CimdAddress,
  CimdAddressResolver,
  CimdHttpRequester,
  CimdHttpResponse,
  FetchCimdMetadataOptions,
  FetchedCimdMetadata,
} from '#core/cimd.js';
export {
  fetchClientIdMetadata,
  isPublicUnicastAddress,
  OAUTH_CIMD_FETCH_TIMEOUT_MS,
  OAUTH_CIMD_MAX_BODY_BYTES,
} from '#core/cimd.js';
export type {EmailOwner, FindUserByEmailParams} from '#core/email-owner.js';
export {findUserByEmail} from '#core/email-owner.js';
export type {AdminGrant} from '#core/entities/admin-grant.js';
export type {User, UserStatus} from '#core/entities/user.js';
export type {AgentAccessWorkspaceErrorCode} from '#core/errors.js';
export {
  AdminBootstrapClosedError,
  AdminGrantAlreadyExistsError,
  AdminGrantNotFoundError,
  AdminIdempotencyKeyReuseError,
  AdminRoleRequiredError,
  AgentAccessWorkspaceError,
  AgentGrantNotFoundError,
  AuthDependencyUnavailableError,
  CannotImpersonateAdministratorError,
  CannotImpersonateSelfError,
  EmailNotVerifiedError,
  ImpersonationDisabledError,
  ImpersonationExpiredError,
  ImpersonationTargetNotActiveError,
  InvalidAdminBootstrapTokenError,
  InvalidAdministratorUserDirectoryFilterError,
  InvalidAgentAccessScopeError,
  InvalidCredentialsError,
  InvalidOAuthClientMetadataError,
  InvalidOAuthConfigurationError,
  LastAdminOwnerError,
  OAuthConsentNotFoundError,
  OAuthMetadataFetchError,
  OAuthOwnershipNotFoundError,
  OAuthProtocolError,
  type OAuthProtocolErrorCode,
  type OAuthProtocolErrorParams,
  OAuthRedirectUriNotRegisteredError,
  SignupNotAllowedError,
  UserNotFoundError,
} from '#core/errors.js';
export {
  issueJobLeaseToken,
  jobLeaseParamsFrom,
  verifyJobLeaseToken,
} from '#core/job-lease-token.js';
export type {OAuthGrantType, ValidatedOAuthClientMetadata} from '#core/oauth-client.js';
export {
  assertOAuthClientMetadataMatchesRequest,
  assertOAuthRedirectUriRegistered,
  isOAuthLoopbackRedirectUri,
  metadataForAgentClient,
  OAUTH_CIMD_CACHE_MAX_AGE_SECONDS,
  OAUTH_CLIENT_ID_MAX_BYTES,
  OAUTH_CLIENT_NAME_MAX_BYTES,
  OAUTH_REDIRECT_URI_MAX_BYTES,
  OAUTH_REDIRECT_URI_MAX_COUNT,
  oauthRedirectUriMatches,
  validateOAuthClientId,
  validateOAuthClientMetadataDocument,
  validateOAuthDynamicClientRegistration,
  validateOAuthPublicOrigin,
  validateOAuthRedirectUri,
} from '#core/oauth-client.js';
export type {
  OAuthClientResolver,
  OAuthClientResolverOptions,
  RegisteredOAuthClient,
  RegisterOAuthClientParams,
  ResolvedOAuthClient,
  ResolveOAuthClientParams,
} from '#core/oauth-client-resolver.js';
export {
  createOAuthClientResolver,
  OAUTH_CIMD_CACHE_MAX_ENTRIES,
  registerOAuthClient,
  resolveOAuthClient,
} from '#core/oauth-client-resolver.js';
export type {
  BeginOAuthAuthorizationResult,
  OAuthConsentDetail,
  OAuthConsentWorkspace,
  OAuthFlowOptions,
  OAuthTokenExchangeResult,
} from '#core/oauth-flow.js';
export {
  approveOAuthConsent,
  beginOAuthAuthorization,
  denyOAuthConsent,
  exchangeOAuthAuthorizationCode,
  exchangeOAuthRefreshToken,
  exchangeOAuthToken,
  getOAuthConsentDetail,
  OAUTH_AUTHORIZATION_CODE_TTL_SECONDS,
  OAUTH_AUTHORIZATION_REQUEST_TTL_SECONDS,
} from '#core/oauth-flow.js';
export type {SignupDenialMessageFormat, SignupPolicy} from '#core/ports.js';
export {
  issueRunnerSessionToken,
  verifyRunnerSessionToken,
} from '#core/runner-session-token.js';
export {
  createEnvironmentSignupPolicy,
  DEFAULT_SIGNUP_NOT_ALLOWED_MESSAGE,
} from '#core/signup-policy.js';
export type {ImpersonationResult} from '#db/impersonation.js';
export {createAgentAccessAuthMethod} from '#presentation/auth/agent-access-auth.js';
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
export {oauthTokenResponse, toOAuthConsentResponse} from '#presentation/dto/oauth.js';
export {
  createAgentAccessManagementRoutes,
  createAgentAccessRoutes,
  createAgentGrantRoutes,
} from '#presentation/routes/agent-access.js';
export type {
  CreateOAuthAuthorizationRoutesOptions,
  CreateOAuthRoutesOptions,
} from '#presentation/routes/oauth.js';
export {
  createOAuthAuthorizationRoutes,
  createOAuthClientIdentificationRoutes,
  createOAuthMetadataRoutes,
  createOAuthRoutes,
} from '#presentation/routes/oauth.js';

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
    auth: [
      createJwtAuthMethod(),
      createLeaseTokenAuthMethod(),
      createRunnerSessionAuthMethod(),
      createAgentAccessAuthMethod(),
    ],
    loginMethods: passwordLoginMethods(config.AUTH_PASSWORD_ENABLED),
    routes: [
      buildAuthRoutes(config.AUTH_PASSWORD_ENABLED, workspaces, signupPolicy),
      administrationBootstrapRoutes,
      administrationRoutes,
      ...createAdministrationUserRoutes(workspaces),
      createOAuthRoutes({apiPublicUrl: config.API_PUBLIC_URL}),
      createOAuthAuthorizationRoutes({
        apiPublicUrl: config.API_PUBLIC_URL,
        workspaces,
      }),
      createAgentAccessManagementRoutes(),
    ],
    e2eRoutes: [createAuthE2eRoutes(workspaces)],
    publishers: [{name: 'auth', table: authOutbox, db, eventSchemas: authPublisherEventSchemas}],
    subscribers: [subscriber(AUTH_PASSWORD_RESET_SEND_REQUESTED, onPasswordResetSendRequested)],
    workers: [
      {
        taskQueue: AUTH_AGENT_ACCESS_MAINTENANCE_TASK_QUEUE,
        workflowsPath,
        activities: createAuthMaintenanceActivities,
        workflows: [
          {
            name: 'agentAccessRetentionCron',
            id: 'auth-agent-access-retention',
            cronSchedule: '10 * * * *',
          },
        ],
      },
    ],
    interModulePresentations: [createAuthInterModulePresentation()],
  };
}
