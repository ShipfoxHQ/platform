import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {
  OAUTH_MCP_RESOURCE_PATH,
  OAUTH_READ_SCOPE,
  type OAuthAuthorizeQueryDto,
  type OAuthTokenRequestDto,
} from '@shipfox/api-auth-dto';
import {
  type WorkspacesInterModuleClient,
  workspacesInterModuleContract,
} from '@shipfox/api-workspaces-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {config} from '#config.js';
import {
  agentRefreshTokenExpiresAt,
  approveAgentAuthorizationRequest,
  claimAgentAuthorizationRequest,
  createAgentAuthorizationRequest,
  denyAgentAuthorizationRequest,
  evaluateAgentGrantBinding,
  exchangeAgentAuthorizationCode,
  exchangeAgentRefreshToken,
  findAgentAuthorizationCodeByHash,
  findAgentClientById,
  findAgentGrant,
  findAgentRefreshTokenByHash,
  isActiveAgentUser,
} from '#db/agent-access.js';
import {recordTokenRefreshed} from '#metrics/index.js';
import {issueAgentAccessToken} from './agent-access-token.js';
import type {AgentAuthorizationRequest, AgentClient, AgentGrant} from './entities/agent-access.js';
import {
  AuthDependencyUnavailableError,
  InvalidOAuthClientMetadataError,
  OAuthConsentNotFoundError,
  OAuthOwnershipNotFoundError,
  OAuthProtocolError,
  OAuthRedirectUriNotRegisteredError,
} from './errors.js';
import type {OAuthClientResolver} from './oauth-client-resolver.js';
import {createOAuthClientResolver} from './oauth-client-resolver.js';

export const OAUTH_AUTHORIZATION_REQUEST_TTL_SECONDS = 5 * 60;
export const OAUTH_AUTHORIZATION_CODE_TTL_SECONDS = 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface OAuthFlowOptions {
  /** The normalized API origin, validated by the route factory. */
  apiPublicOrigin: string;
  /** Dashboard base URL used only for the opaque consent redirect. */
  clientBaseUrl?: string;
  workspaces: WorkspacesInterModuleClient;
  clientResolver?: OAuthClientResolver;
  now?: () => Date;
}

export interface BeginOAuthAuthorizationResult {
  request: AgentAuthorizationRequest;
  consentUrl: string;
}

export interface OAuthConsentWorkspace {
  workspaceId: string;
  role: string;
}

export interface OAuthConsentDetail {
  request: AgentAuthorizationRequest;
  client: AgentClient;
  workspaces: OAuthConsentWorkspace[];
}

export interface OAuthTokenExchangeResult {
  accessToken: string;
  refreshToken?: string;
  scope: 'read';
}

function nowFor(options: OAuthFlowOptions): Date {
  return options.now?.() ?? new Date();
}

function expectedResource(options: OAuthFlowOptions): string {
  return `${options.apiPublicOrigin}${OAUTH_MCP_RESOURCE_PATH}`;
}

function invalidRequest(message: string, params: {redirectUri?: string; state?: string} = {}) {
  return new OAuthProtocolError('invalid_request', message, params);
}

function invalidGrant(message = 'The OAuth grant is invalid'): OAuthProtocolError {
  return new OAuthProtocolError('invalid_grant', message);
}

function invalidClient(message = 'The OAuth client is invalid'): OAuthProtocolError {
  return new OAuthProtocolError('invalid_client', message);
}

function inactiveUserError(): OAuthProtocolError {
  return new OAuthProtocolError('access_denied', 'The user is not active');
}

function assertConsentRequestId(requestId: string): void {
  if (!UUID_PATTERN.test(requestId)) throw new OAuthConsentNotFoundError();
}

function redirectableError(
  code: 'invalid_request' | 'invalid_scope' | 'invalid_target' | 'access_denied',
  message: string,
  request: Pick<OAuthAuthorizeQueryDto, 'redirect_uri' | 'state'>,
): OAuthProtocolError {
  return new OAuthProtocolError(code, message, {
    redirectUri: request.redirect_uri,
    ...(request.state !== undefined ? {state: request.state} : {}),
  });
}

function newOpaqueValue(): string {
  return randomBytes(32).toString('base64url');
}

function consentBaseUrl(options: OAuthFlowOptions): URL {
  const baseUrl = options.clientBaseUrl ?? config.CLIENT_BASE_URL;
  try {
    return new URL(baseUrl);
  } catch {
    throw new OAuthProtocolError('invalid_request', 'The OAuth consent URL is not configured', {
      status: 500,
    });
  }
}

function consentUrl(baseUrl: URL, requestId: string): string {
  const url = new URL('/oauth/consent', baseUrl);
  url.searchParams.set('request_id', requestId);
  return url.toString();
}

function authorizationRedirect(
  redirectUri: string,
  params: {code?: string; error?: string; state?: string | null},
): string {
  const url = new URL(redirectUri);
  if (params.code !== undefined) url.searchParams.set('code', params.code);
  if (params.error !== undefined) url.searchParams.set('error', params.error);
  if (params.state !== undefined && params.state !== null) {
    url.searchParams.set('state', params.state);
  }
  return url.toString();
}

function isActiveWorkspaceStatus(status: string): boolean {
  return status === 'active';
}

async function currentMemberships(
  userId: string,
  options: OAuthFlowOptions,
): Promise<OAuthConsentWorkspace[]> {
  let result: Awaited<ReturnType<WorkspacesInterModuleClient['listMembershipsForTokenClaims']>>;
  try {
    result = await options.workspaces.listMembershipsForTokenClaims({userId});
  } catch (error) {
    throw new AuthDependencyUnavailableError('workspaces', error);
  }
  return result.memberships
    .filter((membership) => isActiveWorkspaceStatus(membership.workspaceStatus))
    .map((membership) => ({workspaceId: membership.workspaceId, role: membership.role}));
}

async function requireCurrentMembership(params: {
  userId: string;
  workspaceId: string;
  options: OAuthFlowOptions;
  ownershipShape: boolean;
}): Promise<void> {
  let result: Awaited<ReturnType<WorkspacesInterModuleClient['listMembershipsForTokenClaims']>>;
  try {
    result = await params.options.workspaces.listMembershipsForTokenClaims({
      userId: params.userId,
    });
    await params.options.workspaces.requireActiveMembership({
      userId: params.userId,
      workspaceId: params.workspaceId,
      memberships: result.memberships,
    });
  } catch (error) {
    if (
      isInterModuleKnownError(workspacesInterModuleContract.methods.requireActiveMembership, error)
    ) {
      if (params.ownershipShape) throw new OAuthOwnershipNotFoundError();
      throw invalidGrant('The workspace grant is no longer active');
    }
    if (error instanceof AuthDependencyUnavailableError) throw error;
    throw new AuthDependencyUnavailableError('workspaces', error);
  }
}

export async function beginOAuthAuthorization(params: {
  request: OAuthAuthorizeQueryDto;
  requestIp: string;
  options: OAuthFlowOptions;
}): Promise<BeginOAuthAuthorizationResult> {
  const consentBase = consentBaseUrl(params.options);
  const resolver = params.options.clientResolver ?? createOAuthClientResolver();
  let resolved: Awaited<ReturnType<OAuthClientResolver['resolve']>>;
  try {
    resolved = await resolver.resolve({
      clientId: params.request.client_id,
      requestIp: params.requestIp,
      redirectUri: params.request.redirect_uri,
    });
  } catch (error) {
    if (error instanceof OAuthRedirectUriNotRegisteredError) {
      throw invalidRequest('The OAuth redirect URI is not registered');
    }
    if (error instanceof InvalidOAuthClientMetadataError) throw invalidClient();
    throw error;
  }

  if (params.request.resource !== expectedResource(params.options)) {
    throw redirectableError(
      'invalid_target',
      'The OAuth resource is not supported',
      params.request,
    );
  }
  if (params.request.scope !== undefined && params.request.scope !== 'read') {
    throw redirectableError(
      'invalid_scope',
      'The requested OAuth scope is not supported',
      params.request,
    );
  }

  const now = nowFor(params.options);
  const request = await createAgentAuthorizationRequest({
    clientId: resolved.client.id,
    redirectUri: params.request.redirect_uri,
    resource: params.request.resource,
    scopes: ['read'],
    codeChallenge: params.request.code_challenge,
    state: params.request.state ?? null,
    expiresAt: new Date(now.getTime() + OAUTH_AUTHORIZATION_REQUEST_TTL_SECONDS * 1000),
  });

  return {request, consentUrl: consentUrl(consentBase, request.id)};
}

export async function getOAuthConsentDetail(params: {
  requestId: string;
  userId: string;
  options: OAuthFlowOptions;
}): Promise<OAuthConsentDetail> {
  assertConsentRequestId(params.requestId);
  if (!(await isActiveAgentUser({userId: params.userId}))) throw inactiveUserError();
  const request = await claimAgentAuthorizationRequest({
    id: params.requestId,
    userId: params.userId,
  });
  if (!request) throw new OAuthConsentNotFoundError();
  const client = await findAgentClientById({id: request.clientId});
  if (!client) throw new OAuthConsentNotFoundError();
  const workspaces = await currentMemberships(params.userId, params.options);
  return {request, client, workspaces};
}

export async function approveOAuthConsent(params: {
  requestId: string;
  userId: string;
  workspaceId: string;
  options: OAuthFlowOptions;
}): Promise<{redirectUrl: string}> {
  assertConsentRequestId(params.requestId);
  await requireCurrentMembership({
    userId: params.userId,
    workspaceId: params.workspaceId,
    options: params.options,
    ownershipShape: true,
  });

  const rawCode = newOpaqueValue();
  const now = nowFor(params.options);
  const result = await approveAgentAuthorizationRequest({
    id: params.requestId,
    userId: params.userId,
    workspaceId: params.workspaceId,
    hashedCode: hashOpaqueToken(rawCode),
    codeExpiresAt: new Date(now.getTime() + OAUTH_AUTHORIZATION_CODE_TTL_SECONDS * 1000),
  });
  if (result.kind === 'inactive') throw inactiveUserError();
  if (result.kind === 'not-found') throw new OAuthConsentNotFoundError();

  return {
    redirectUrl: authorizationRedirect(result.request.redirectUri, {
      code: rawCode,
      state: result.request.state,
    }),
  };
}

export async function denyOAuthConsent(params: {
  requestId: string;
  userId: string;
}): Promise<{redirectUrl: string}> {
  assertConsentRequestId(params.requestId);
  const result = await denyAgentAuthorizationRequest({
    id: params.requestId,
    userId: params.userId,
  });
  if (result.kind === 'inactive') throw inactiveUserError();
  if (result.kind === 'not-found') throw new OAuthConsentNotFoundError();

  return {
    redirectUrl: authorizationRedirect(result.request.redirectUri, {
      error: 'access_denied',
      state: result.request.state,
    }),
  };
}

function pkceMatches(verifier: string, challenge: string): boolean {
  const candidate = createHash('sha256').update(verifier).digest('base64url');
  const candidateBytes = Buffer.from(candidate, 'utf8');
  const challengeBytes = Buffer.from(challenge, 'utf8');
  return (
    candidateBytes.length === challengeBytes.length &&
    timingSafeEqual(candidateBytes, challengeBytes)
  );
}

async function grantBinding(params: {
  clientId: string;
  grantId: string;
  resource: string | undefined;
  expectedResource: string;
}): Promise<{grant: AgentGrant; client: AgentClient}> {
  const grant = await findAgentGrant({id: params.grantId});
  const client = grant ? await findAgentClientById({id: grant.clientId}) : undefined;
  const binding = evaluateAgentGrantBinding({
    grant,
    client,
    clientId: params.clientId,
    resource: params.resource,
    expectedResource: params.expectedResource,
  });
  if (binding.kind === 'invalid') {
    if (binding.reason === 'resource') {
      throw new OAuthProtocolError('invalid_target', 'The OAuth resource is not supported');
    }
    throw invalidGrant();
  }
  return {grant: binding.grant, client: binding.client};
}

function accessTokenFor(grant: AgentGrant, client: AgentClient): Promise<string> {
  return issueAgentAccessToken({
    sub: grant.userId,
    workspaceId: grant.workspaceId,
    grantId: grant.id,
    clientId: client.clientId,
    scopes: ['read'],
  });
}

export async function exchangeOAuthAuthorizationCode(params: {
  request: OAuthTokenRequestDto;
  options: OAuthFlowOptions;
}): Promise<OAuthTokenExchangeResult> {
  if (!params.request.code || !params.request.code_verifier || !params.request.redirect_uri) {
    throw invalidRequest('The authorization-code request is incomplete');
  }

  const hashedCode = hashOpaqueToken(params.request.code);
  const existing = await findAgentAuthorizationCodeByHash({hashedCode});
  if (!existing) throw invalidGrant();
  const binding = await grantBinding({
    clientId: params.request.client_id,
    grantId: existing.grantId,
    resource: params.request.resource,
    expectedResource: expectedResource(params.options),
  });
  if (params.request.redirect_uri !== existing.redirectUri) throw invalidGrant();
  if (!pkceMatches(params.request.code_verifier, existing.codeChallenge)) throw invalidGrant();

  await requireCurrentMembership({
    userId: binding.grant.userId,
    workspaceId: binding.grant.workspaceId,
    options: params.options,
    ownershipShape: false,
  });

  const rawRefreshToken = newOpaqueValue();
  const exchange = await exchangeAgentAuthorizationCode({
    hashedCode,
    hashedRefreshToken: hashOpaqueToken(rawRefreshToken),
    refreshTokenExpiresAt: agentRefreshTokenExpiresAt(nowFor(params.options)),
  });
  if (!exchange) throw invalidGrant();

  return {
    accessToken: await accessTokenFor(binding.grant, binding.client),
    refreshToken: rawRefreshToken,
    scope: 'read',
  };
}

export async function exchangeOAuthRefreshToken(params: {
  request: OAuthTokenRequestDto;
  options: OAuthFlowOptions;
}): Promise<OAuthTokenExchangeResult> {
  if (!params.request.refresh_token)
    throw invalidRequest('The refresh-token request is incomplete');

  const hashedToken = hashOpaqueToken(params.request.refresh_token);
  const existing = await findAgentRefreshTokenByHash({hashedToken});
  if (!existing) throw invalidGrant();
  const grant = await findAgentGrant({id: existing.grantId});
  const client = grant ? await findAgentClientById({id: grant.clientId}) : undefined;
  const binding = evaluateAgentGrantBinding({
    grant,
    client,
    clientId: params.request.client_id,
    resource: params.request.resource,
    expectedResource: expectedResource(params.options),
  });
  if (binding.kind === 'invalid') {
    if (binding.reason === 'resource') {
      throw new OAuthProtocolError('invalid_target', 'The OAuth resource is not supported');
    }
    throw invalidGrant();
  }

  await requireCurrentMembership({
    userId: binding.grant.userId,
    workspaceId: binding.grant.workspaceId,
    options: params.options,
    ownershipShape: false,
  });

  // Keep the inter-module membership check outside the database transaction.
  // The DB helper re-reads and revalidates the binding under its transaction so
  // rotation remains safe if the grant or client changes while this check runs.
  const now = nowFor(params.options);
  const rawReplacement = newOpaqueValue();
  const outcome = await exchangeAgentRefreshToken({
    hashedToken,
    clientId: params.request.client_id,
    resource: params.request.resource,
    expectedResource: expectedResource(params.options),
    replacementHashedToken: hashOpaqueToken(rawReplacement),
    replacementExpiresAt: agentRefreshTokenExpiresAt(now),
    now,
  });
  if (outcome.kind === 'reused') {
    recordTokenRefreshed('reused');
    throw invalidGrant();
  }
  if (outcome.kind === 'rejected' || !outcome.grant) {
    recordTokenRefreshed('rejected');
    throw invalidGrant();
  }
  recordTokenRefreshed(outcome.kind);

  return {
    accessToken: await accessTokenFor(outcome.grant, binding.client),
    ...(outcome.kind === 'rotated' ? {refreshToken: rawReplacement} : {}),
    scope: 'read',
  };
}

export async function exchangeOAuthToken(params: {
  request: OAuthTokenRequestDto;
  options: OAuthFlowOptions;
}): Promise<OAuthTokenExchangeResult> {
  if (params.request.scope !== undefined && params.request.scope !== OAUTH_READ_SCOPE) {
    throw new OAuthProtocolError('invalid_scope', 'The requested OAuth scope is not supported');
  }
  if (params.request.grant_type === 'authorization_code') {
    return await exchangeOAuthAuthorizationCode(params);
  }
  return await exchangeOAuthRefreshToken(params);
}
