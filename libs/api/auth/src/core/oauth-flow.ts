import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import type {
  OAuthAuthorizeQueryDto,
  OAuthConsentResponseDto,
  OAuthTokenRequestDto,
} from '@shipfox/api-auth-dto';
import {
  type WorkspacesInterModuleClient,
  workspacesInterModuleContract,
} from '@shipfox/api-workspaces-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {config} from '#config.js';
import {
  type AgentAccessTx,
  agentRefreshTokenExpiresAt,
  consumeAgentAuthorizationCodeTx,
  consumeAgentAuthorizationRequestTx,
  createAgentAuthorizationCodeTx,
  createAgentAuthorizationRequest,
  createAgentGrantTx,
  createAgentRefreshTokenTx,
  findAgentAuthorizationCodeByHash,
  findAgentClientById,
  findAgentGrant,
  findAgentRefreshTokenByHash,
  findPendingAgentAuthorizationRequest,
  isActiveAgentUser,
  isActiveAgentUserTx,
  resolveAgentRefreshTokenReplayTx,
  rotateAgentRefreshTokenTx,
} from '#db/agent-access.js';
import {db} from '#db/db.js';
import {
  AGENT_ACCESS_TOKEN_EXPIRES_IN_SECONDS,
  issueAgentAccessToken,
} from './agent-access-token.js';
import type {AgentAuthorizationRequest, AgentClient, AgentGrant} from './entities/agent-access.js';
import {
  AuthDependencyUnavailableError,
  InvalidOAuthClientMetadataError,
  OAuthConsentNotFoundError,
  OAuthOwnershipNotFoundError,
  OAuthProtocolError,
  OAuthRedirectUriNotRegisteredError,
} from './errors.js';
import {isOAuthLoopbackRedirectUri} from './oauth-client.js';
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

interface RefreshExchangeOutcome {
  kind: 'rotated' | 'grace' | 'rejected' | 'reused';
  grant?: AgentGrant;
  refreshToken?: string;
}

function nowFor(options: OAuthFlowOptions): Date {
  return options.now?.() ?? new Date();
}

function expectedResource(options: OAuthFlowOptions): string {
  return `${options.apiPublicOrigin}/mcp`;
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

function consentUrl(options: OAuthFlowOptions, requestId: string): string {
  const baseUrl = options.clientBaseUrl ?? config.CLIENT_BASE_URL;
  try {
    const url = new URL('/oauth/consent', baseUrl);
    url.searchParams.set('request_id', requestId);
    return url.toString();
  } catch (error) {
    throw new OAuthProtocolError('invalid_request', 'The OAuth consent URL is not configured', {
      status: 500,
      ...(error instanceof Error ? {description: error.message} : {}),
    });
  }
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

function identityOrigin(client: AgentClient): string {
  if (client.kind === 'registered') return 'registered client';
  try {
    return new URL(client.clientId).origin;
  } catch {
    // A CIMD client was validated before it was stored. Keep an invalid row
    // from becoming a request-time crash if old data predates that check.
    return client.clientId;
  }
}

function consentDetailDto(detail: OAuthConsentDetail): OAuthConsentResponseDto {
  const redirectUrl = new URL(detail.request.redirectUri);
  return {
    request_id: detail.request.id,
    client_name: detail.client.name,
    scope: 'read',
    expires_at: detail.request.expiresAt.toISOString(),
    redirect_uri_hostname: redirectUrl.hostname,
    client_identity_origin: identityOrigin(detail.client),
    is_loopback_redirect: isOAuthLoopbackRedirectUri(detail.request.redirectUri),
    workspaces: detail.workspaces.map(({workspaceId, role}) => ({
      workspace_id: workspaceId,
      role,
    })),
  };
}

export async function beginOAuthAuthorization(params: {
  request: OAuthAuthorizeQueryDto;
  requestIp: string;
  options: OAuthFlowOptions;
}): Promise<BeginOAuthAuthorizationResult> {
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

  return {request, consentUrl: consentUrl(params.options, request.id)};
}

export async function getOAuthConsentDetail(params: {
  requestId: string;
  userId: string;
  options: OAuthFlowOptions;
}): Promise<OAuthConsentDetail> {
  assertConsentRequestId(params.requestId);
  if (!(await isActiveAgentUser({userId: params.userId}))) throw inactiveUserError();
  const request = await findPendingRequestOrThrow(params.requestId);
  const client = await findAgentClientById({id: request.clientId});
  if (!client) throw new OAuthConsentNotFoundError();
  const workspaces = await currentMemberships(params.userId, params.options);
  return {request, client, workspaces};
}

export function toOAuthConsentResponse(detail: OAuthConsentDetail): OAuthConsentResponseDto {
  return consentDetailDto(detail);
}

async function findPendingRequestOrThrow(requestId: string): Promise<AgentAuthorizationRequest> {
  const request = await findPendingAgentAuthorizationRequest({id: requestId});
  if (!request) throw new OAuthConsentNotFoundError();
  return request;
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
  const result = await db().transaction(async (tx) => {
    if (!(await isActiveAgentUserTx(tx, {userId: params.userId}))) {
      throw inactiveUserError();
    }

    const request = await consumeAgentAuthorizationRequestTx(tx, {id: params.requestId});
    if (!request) throw new OAuthConsentNotFoundError();

    const grant = await createAgentGrantTx(tx, {
      userId: params.userId,
      workspaceId: params.workspaceId,
      clientId: request.clientId,
      scopes: request.scopes,
    });
    await createAgentAuthorizationCodeTx(tx, {
      grantId: grant.id,
      hashedCode: hashOpaqueToken(rawCode),
      codeChallenge: request.codeChallenge,
      redirectUri: request.redirectUri,
      resource: request.resource,
      expiresAt: new Date(now.getTime() + OAUTH_AUTHORIZATION_CODE_TTL_SECONDS * 1000),
    });
    return {request};
  });

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
  const result = await db().transaction(async (tx) => {
    if (!(await isActiveAgentUserTx(tx, {userId: params.userId}))) {
      throw inactiveUserError();
    }
    const request = await consumeAgentAuthorizationRequestTx(tx, {id: params.requestId});
    if (!request) throw new OAuthConsentNotFoundError();
    return {request};
  });

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
  if (!grant || grant.revokedAt || grant.terminalAt) throw invalidGrant();
  const client = await findAgentClientById({id: grant.clientId});
  if (!client || client.clientId !== params.clientId) throw invalidGrant();
  if (params.resource !== undefined && params.resource !== params.expectedResource) {
    throw new OAuthProtocolError('invalid_target', 'The OAuth resource is not supported');
  }
  return {grant, client};
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
  const exchange = await db().transaction(async (tx) => {
    const code = await consumeAgentAuthorizationCodeTx(tx, {hashedCode});
    if (!code) return undefined;
    const refreshToken = await createAgentRefreshTokenTx(tx, {
      grantId: code.grantId,
      hashedToken: hashOpaqueToken(rawRefreshToken),
      expiresAt: agentRefreshTokenExpiresAt(nowFor(params.options)),
    });
    return {code, refreshToken};
  });
  if (!exchange) throw invalidGrant();

  return {
    accessToken: await accessTokenFor(binding.grant, binding.client),
    refreshToken: rawRefreshToken,
    scope: 'read',
  };
}

async function refreshReplayOutcome(
  tx: AgentAccessTx,
  params: {hashedToken: string; options: OAuthFlowOptions},
): Promise<RefreshExchangeOutcome> {
  const replay = await resolveAgentRefreshTokenReplayTx(tx, {
    hashedToken: params.hashedToken,
    now: nowFor(params.options),
  });
  if (!replay) return {kind: 'rejected'};
  if (replay.kind === 'reused') return {kind: 'reused', grant: replay.grant};
  return {kind: 'grace', grant: replay.grant};
}

async function rotateRefreshInTransaction(
  tx: AgentAccessTx,
  params: {
    hashedToken: string;
    rawReplacement: string;
    grant: AgentGrant;
    options: OAuthFlowOptions;
  },
): Promise<RefreshExchangeOutcome> {
  const successor = await rotateAgentRefreshTokenTx(tx, {
    hashedToken: params.hashedToken,
    replacementHashedToken: hashOpaqueToken(params.rawReplacement),
    replacementExpiresAt: agentRefreshTokenExpiresAt(nowFor(params.options)),
  });
  if (successor) {
    return {kind: 'rotated', grant: params.grant, refreshToken: params.rawReplacement};
  }

  // Another transaction may have rotated the token while this transaction
  // waited on the grant row. Resolve the now-rotated predecessor under the
  // same lock so a grace response and replay revocation remain serialized.
  return await refreshReplayOutcome(tx, {
    hashedToken: params.hashedToken,
    options: params.options,
  });
}

async function refreshExchange(params: {
  hashedToken: string;
  clientId: string;
  resource: string | undefined;
  options: OAuthFlowOptions;
}): Promise<RefreshExchangeOutcome> {
  const rawReplacement = newOpaqueValue();
  return await db().transaction(async (tx) => {
    const existing = await findAgentRefreshTokenByHash({
      hashedToken: params.hashedToken,
      executor: tx,
    });
    if (!existing) return {kind: 'rejected'};

    const grant = await findAgentGrant({id: existing.grantId, executor: tx});
    if (!grant || grant.revokedAt || grant.terminalAt) return {kind: 'rejected'};
    const client = await findAgentClientById({id: grant.clientId, executor: tx});
    if (!client || client.clientId !== params.clientId) return {kind: 'rejected'};
    if (params.resource !== undefined && params.resource !== expectedResource(params.options)) {
      return {kind: 'rejected'};
    }

    if (existing.rotatedAt) {
      return await refreshReplayOutcome(tx, {
        hashedToken: params.hashedToken,
        options: params.options,
      });
    }

    return await rotateRefreshInTransaction(tx, {
      hashedToken: params.hashedToken,
      rawReplacement,
      grant,
      options: params.options,
    });
  });
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
  if (!grant || grant.revokedAt || grant.terminalAt) throw invalidGrant();
  const client = await findAgentClientById({id: grant.clientId});
  if (!client || client.clientId !== params.request.client_id) throw invalidGrant();
  if (
    params.request.resource !== undefined &&
    params.request.resource !== expectedResource(params.options)
  ) {
    throw new OAuthProtocolError('invalid_target', 'The OAuth resource is not supported');
  }

  await requireCurrentMembership({
    userId: grant.userId,
    workspaceId: grant.workspaceId,
    options: params.options,
    ownershipShape: false,
  });

  const outcome = await refreshExchange({
    hashedToken,
    clientId: params.request.client_id,
    resource: params.request.resource,
    options: params.options,
  });
  if (outcome.kind === 'reused' || outcome.kind === 'rejected' || !outcome.grant) {
    throw invalidGrant();
  }

  return {
    accessToken: await accessTokenFor(outcome.grant, client),
    ...(outcome.refreshToken ? {refreshToken: outcome.refreshToken} : {}),
    scope: 'read',
  };
}

export async function exchangeOAuthToken(params: {
  request: OAuthTokenRequestDto;
  options: OAuthFlowOptions;
}): Promise<OAuthTokenExchangeResult> {
  if (params.request.grant_type === 'authorization_code') {
    return await exchangeOAuthAuthorizationCode(params);
  }
  return await exchangeOAuthRefreshToken(params);
}

export function oauthTokenResponse(result: OAuthTokenExchangeResult) {
  return {
    access_token: result.accessToken,
    token_type: 'Bearer' as const,
    expires_in: AGENT_ACCESS_TOKEN_EXPIRES_IN_SECONDS,
    ...(result.refreshToken ? {refresh_token: result.refreshToken} : {}),
    scope: result.scope,
  };
}
