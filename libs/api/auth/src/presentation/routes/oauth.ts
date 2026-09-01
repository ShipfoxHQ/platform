import {AUTH_USER, getUserContext, rejectImpersonatedSession} from '@shipfox/api-auth-context';
import {
  type OAuthDynamicClientRegistrationResponseDto,
  oauthAuthorizationServerMetadataSchema,
  oauthAuthorizeQuerySchema,
  oauthConsentApprovalBodySchema,
  oauthConsentDecisionResponseSchema,
  oauthConsentParamsSchema,
  oauthConsentResponseSchema,
  oauthDynamicClientRegistrationRequestSchema,
  oauthDynamicClientRegistrationResponseSchema,
  oauthProtectedResourceMetadataSchema,
  oauthTokenRequestSchema,
  oauthTokenResponseSchema,
} from '@shipfox/api-auth-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {
  ClientError,
  defineRoute,
  type FastifyReply,
  type FastifyRequest,
  type RouteGroup,
} from '@shipfox/node-fastify';
import type {FastifyPluginAsync} from 'fastify';
import fp from 'fastify-plugin';
import {
  AuthDependencyUnavailableError,
  InvalidOAuthClientMetadataError,
  InvalidOAuthConfigurationError,
  OAuthConsentNotFoundError,
  OAuthMetadataFetchError,
  OAuthOwnershipNotFoundError,
  OAuthProtocolError,
  OAuthRedirectUriNotRegisteredError,
} from '#core/errors.js';
import {validateOAuthPublicOrigin} from '#core/oauth-client.js';
import {
  createOAuthClientResolver,
  type OAuthClientResolver,
  registerOAuthClient,
} from '#core/oauth-client-resolver.js';
import {
  approveOAuthConsent,
  beginOAuthAuthorization,
  denyOAuthConsent,
  exchangeOAuthToken,
  getOAuthConsentDetail,
  type OAuthFlowOptions,
  oauthTokenResponse,
  toOAuthConsentResponse,
} from '#core/oauth-flow.js';
import {createAuthIpRateLimitPreHandler} from './rate-limit.js';

export interface CreateOAuthRoutesOptions {
  /** Validated here and deliberately injected until production composition. */
  apiPublicUrl: string;
  /** Optional dashboard base URL override for isolated route tests. */
  clientBaseUrl?: string;
  /** Optional resolver override for isolated CIMD/client tests. */
  clientResolver?: OAuthClientResolver;
}

export interface CreateOAuthAuthorizationRoutesOptions extends CreateOAuthRoutesOptions {
  workspaces: WorkspacesInterModuleClient;
}

function apiPublicOrigin(options: CreateOAuthRoutesOptions): string {
  return validateOAuthPublicOrigin(options.apiPublicUrl);
}

function translateOAuthRegistrationError(error: unknown): never {
  if (
    error instanceof InvalidOAuthClientMetadataError ||
    error instanceof OAuthMetadataFetchError ||
    error instanceof OAuthRedirectUriNotRegisteredError
  ) {
    throw new ClientError('OAuth client metadata is invalid', 'invalid-client-metadata', {
      status: 400,
    });
  }
  if (error instanceof InvalidOAuthConfigurationError) {
    throw new ClientError('OAuth configuration is invalid', 'oauth-configuration-invalid', {
      status: 500,
    });
  }
  throw error;
}

function isFastifyValidationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as {code?: unknown}).code === 'FST_ERR_VALIDATION'
  );
}

function oauthErrorPayload(error: OAuthProtocolError): {
  error: OAuthProtocolError['code'];
  error_description?: string;
} {
  return {
    error: error.code,
    ...((error.description ?? error.message)
      ? {error_description: error.description ?? error.message}
      : {}),
  };
}

function sendOAuthProtocolError(error: OAuthProtocolError, reply: FastifyReply) {
  return reply.code(error.status).send(oauthErrorPayload(error));
}

function oauthAuthorizationErrorRedirect(error: OAuthProtocolError): string {
  if (!error.redirectUri) throw new Error('OAuth authorization error has no redirect URI');
  const url = new URL(error.redirectUri);
  url.searchParams.set('error', error.code);
  if (error.description ?? error.message) {
    url.searchParams.set('error_description', error.description ?? error.message);
  }
  if (error.state !== undefined && error.state !== null) {
    url.searchParams.set('state', error.state);
  }
  return url.toString();
}

function translateOAuthAuthorizationError(
  error: unknown,
  _request: FastifyRequest,
  reply: FastifyReply,
): unknown {
  if (error instanceof OAuthProtocolError) {
    if (error.redirectUri) return reply.redirect(oauthAuthorizationErrorRedirect(error));
    return sendOAuthProtocolError(error, reply);
  }
  if (isFastifyValidationError(error)) {
    return reply.code(400).send({error: 'invalid_request'});
  }
  if (error instanceof OAuthRedirectUriNotRegisteredError) {
    return reply
      .code(400)
      .send({error: 'invalid_request', error_description: 'The OAuth redirect URI is invalid'});
  }
  if (
    error instanceof InvalidOAuthClientMetadataError ||
    error instanceof OAuthMetadataFetchError
  ) {
    return reply.code(400).send({error: 'invalid_client'});
  }
  if (error instanceof InvalidOAuthConfigurationError) {
    throw new ClientError('OAuth configuration is invalid', 'oauth-configuration-invalid', {
      status: 500,
    });
  }
  throw error;
}

function translateOAuthTokenError(
  error: unknown,
  _request: FastifyRequest,
  reply: FastifyReply,
): unknown {
  if (error instanceof OAuthProtocolError) return sendOAuthProtocolError(error, reply);
  if (isFastifyValidationError(error)) return reply.code(400).send({error: 'invalid_request'});
  if (error instanceof AuthDependencyUnavailableError) {
    throw new ClientError('Authentication dependency unavailable', 'auth-dependency-unavailable', {
      status: 503,
      cause: error,
    });
  }
  throw error;
}

function translateOAuthConsentError(error: unknown): never {
  if (error instanceof OAuthProtocolError && error.code === 'access_denied') {
    throw new ClientError('OAuth consent approval was denied', 'access-denied', {
      status: 403,
      cause: error,
    });
  }
  if (error instanceof OAuthConsentNotFoundError || error instanceof OAuthOwnershipNotFoundError) {
    throw new ClientError('OAuth consent request not found', 'not-found', {status: 404});
  }
  if (error instanceof AuthDependencyUnavailableError) {
    throw new ClientError('Authentication dependency unavailable', 'auth-dependency-unavailable', {
      status: 503,
      cause: error,
    });
  }
  throw error;
}

function registrationResponse(
  result: Awaited<ReturnType<typeof registerOAuthClient>>,
): OAuthDynamicClientRegistrationResponseDto {
  return {
    client_id: result.metadata.clientId,
    client_name: result.metadata.clientName,
    redirect_uris: result.metadata.redirectUris,
    grant_types: result.metadata.grantTypes,
    response_types: result.metadata.responseTypes,
    token_endpoint_auth_method: result.metadata.tokenEndpointAuthMethod,
    scope: result.metadata.scope,
  };
}

function createProtectedResourceMetadataRoute(origin: string) {
  return defineRoute({
    method: 'GET',
    path: '/.well-known/oauth-protected-resource',
    description: 'Describe the protected MCP resource and its authorization server.',
    schema: {response: {200: oauthProtectedResourceMetadataSchema}},
    handler: () => ({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: ['read'],
    }),
  });
}

function createAuthorizationServerMetadataRoute(origin: string) {
  return defineRoute({
    method: 'GET',
    path: '/.well-known/oauth-authorization-server',
    description: 'Describe the MCP OAuth authorization server.',
    schema: {response: {200: oauthAuthorizationServerMetadataSchema}},
    handler: () => ({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['read'],
      client_id_metadata_document_supported: true,
    }),
  });
}

function createDynamicRegistrationRoute() {
  return defineRoute({
    method: 'POST',
    path: '/oauth/register',
    description: 'Register a public OAuth client for MCP access.',
    options: {bodyLimit: 32 * 1024},
    schema: {
      body: oauthDynamicClientRegistrationRequestSchema,
      response: {201: oauthDynamicClientRegistrationResponseSchema},
    },
    preHandler: createAuthIpRateLimitPreHandler('oauth-register'),
    errorHandler: translateOAuthRegistrationError,
    handler: async (request, reply) => {
      const result = await registerOAuthClient({
        clientName: request.body.client_name,
        redirectUris: request.body.redirect_uris,
        grantTypes: request.body.grant_types,
        responseTypes: request.body.response_types,
        tokenEndpointAuthMethod: request.body.token_endpoint_auth_method,
        scope: request.body.scope,
      });
      reply.code(201);
      return registrationResponse(result);
    },
  });
}

function flowOptions(
  options: CreateOAuthAuthorizationRoutesOptions,
  origin: string,
): OAuthFlowOptions {
  return {
    apiPublicOrigin: origin,
    ...(options.clientBaseUrl !== undefined ? {clientBaseUrl: options.clientBaseUrl} : {}),
    workspaces: options.workspaces,
    clientResolver: options.clientResolver ?? createOAuthClientResolver(),
  };
}

const oauthFormBodyPlugin: FastifyPluginAsync = fp((scope) => {
  scope.addContentTypeParser(
    'application/x-www-form-urlencoded',
    {parseAs: 'string', bodyLimit: 32 * 1024},
    (_request, body: string, done: (error: Error | null, value?: unknown) => void) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body)));
      } catch (error) {
        done(error instanceof Error ? error : new Error('Invalid form body'));
      }
    },
  );
  return Promise.resolve();
});

function createOAuthAuthorizeRoute(options: OAuthFlowOptions) {
  return defineRoute({
    method: 'GET',
    path: '/oauth/authorize',
    description: 'Validate an OAuth request and begin the browser consent flow.',
    schema: {querystring: oauthAuthorizeQuerySchema},
    preHandler: createAuthIpRateLimitPreHandler('oauth-authorize'),
    errorHandler: translateOAuthAuthorizationError,
    handler: async (request, reply) => {
      const result = await beginOAuthAuthorization({
        request: request.query,
        requestIp: request.ip,
        options,
      });
      return reply.redirect(result.consentUrl);
    },
  });
}

function createOAuthTokenRoute(options: OAuthFlowOptions) {
  return defineRoute({
    method: 'POST',
    path: '/oauth/token',
    description: 'Exchange an OAuth authorization code or refresh token.',
    options: {bodyLimit: 32 * 1024},
    schema: {
      body: oauthTokenRequestSchema,
      response: {200: oauthTokenResponseSchema},
    },
    preHandler: createAuthIpRateLimitPreHandler('oauth-token'),
    errorHandler: translateOAuthTokenError,
    handler: async (request) =>
      oauthTokenResponse(await exchangeOAuthToken({request: request.body, options})),
  });
}

function createOAuthConsentDetailRoute(options: OAuthFlowOptions) {
  return defineRoute({
    method: 'GET',
    path: '/oauth/consents/:requestId',
    description: 'Load an authenticated OAuth consent request.',
    auth: AUTH_USER,
    schema: {
      params: oauthConsentParamsSchema,
      response: {200: oauthConsentResponseSchema},
    },
    errorHandler: translateOAuthConsentError,
    handler: async (request) => {
      const context = getUserContext(request);
      if (!context) throw new ClientError('Authentication required', 'unauthorized', {status: 401});
      const detail = await getOAuthConsentDetail({
        requestId: request.params.requestId,
        userId: context.userId,
        options,
      });
      return toOAuthConsentResponse(detail);
    },
  });
}

function createOAuthConsentApproveRoute(options: OAuthFlowOptions) {
  return defineRoute({
    method: 'POST',
    path: '/oauth/consents/:requestId/approve',
    description: 'Approve an authenticated OAuth consent request for one workspace.',
    auth: AUTH_USER,
    schema: {
      params: oauthConsentParamsSchema,
      body: oauthConsentApprovalBodySchema,
      response: {200: oauthConsentDecisionResponseSchema},
    },
    errorHandler: translateOAuthConsentError,
    handler: async (request) => {
      const context = getUserContext(request);
      if (!context) throw new ClientError('Authentication required', 'unauthorized', {status: 401});
      rejectImpersonatedSession(request);
      const result = await approveOAuthConsent({
        requestId: request.params.requestId,
        userId: context.userId,
        workspaceId: request.body.workspace_id,
        options,
      });
      return {redirect_url: result.redirectUrl};
    },
  });
}

function createOAuthConsentDenyRoute() {
  return defineRoute({
    method: 'POST',
    path: '/oauth/consents/:requestId/deny',
    description: 'Deny an authenticated OAuth consent request.',
    auth: AUTH_USER,
    schema: {
      params: oauthConsentParamsSchema,
      response: {200: oauthConsentDecisionResponseSchema},
    },
    errorHandler: translateOAuthConsentError,
    handler: async (request) => {
      const context = getUserContext(request);
      if (!context) throw new ClientError('Authentication required', 'unauthorized', {status: 401});
      const result = await denyOAuthConsent({
        requestId: request.params.requestId,
        userId: context.userId,
      });
      return {redirect_url: result.redirectUrl};
    },
  });
}

export function createOAuthMetadataRoutes(options: CreateOAuthRoutesOptions): RouteGroup {
  const origin = apiPublicOrigin(options);
  return {
    prefix: '',
    routes: [
      createProtectedResourceMetadataRoute(origin),
      createAuthorizationServerMetadataRoute(origin),
    ],
  };
}

export function createOAuthClientIdentificationRoutes(): RouteGroup {
  return {prefix: '', routes: [createDynamicRegistrationRoute()]};
}

/** Dormant OAuth authorization, consent, and token routes for isolated composition. */
export function createOAuthAuthorizationRoutes(
  options: CreateOAuthAuthorizationRoutesOptions,
): RouteGroup {
  const origin = apiPublicOrigin(options);
  const flow = flowOptions(options, origin);
  return {
    prefix: '',
    plugins: [oauthFormBodyPlugin],
    routes: [
      createOAuthAuthorizeRoute(flow),
      createOAuthTokenRoute(flow),
      createOAuthConsentDetailRoute(flow),
      createOAuthConsentApproveRoute(flow),
      createOAuthConsentDenyRoute(),
    ],
  };
}

export function createOAuthRoutes(options: CreateOAuthRoutesOptions): RouteGroup {
  const metadataRoutes = createOAuthMetadataRoutes(options);
  const clientIdentificationRoutes = createOAuthClientIdentificationRoutes();
  return {
    prefix: '',
    routes: [...metadataRoutes.routes, ...clientIdentificationRoutes.routes],
  };
}
