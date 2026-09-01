import {
  type OAuthDynamicClientRegistrationResponseDto,
  oauthAuthorizationServerMetadataSchema,
  oauthDynamicClientRegistrationRequestSchema,
  oauthDynamicClientRegistrationResponseSchema,
  oauthProtectedResourceMetadataSchema,
} from '@shipfox/api-auth-dto';
import {ClientError, defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import {
  InvalidOAuthClientMetadataError,
  InvalidOAuthConfigurationError,
  OAuthMetadataFetchError,
  OAuthRedirectUriNotRegisteredError,
} from '#core/errors.js';
import {validateOAuthPublicOrigin} from '#core/oauth-client.js';
import {registerOAuthClient} from '#core/oauth-client-resolver.js';
import {createAuthIpRateLimitPreHandler} from './rate-limit.js';

export interface CreateOAuthRoutesOptions {
  /** Validated here and deliberately injected until production composition. */
  apiPublicUrl?: string;
  /** Compatibility name for callers that already hold a normalized origin. */
  apiPublicOrigin?: string;
}

type OAuthRoutesInput = CreateOAuthRoutesOptions | string;

function apiPublicOrigin(input: OAuthRoutesInput): string {
  const value = typeof input === 'string' ? input : (input.apiPublicUrl ?? input.apiPublicOrigin);
  if (value === undefined) throw new InvalidOAuthConfigurationError();
  return validateOAuthPublicOrigin(value);
}

function translateOAuthError(error: unknown): never {
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
    errorHandler: translateOAuthError,
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

export function createOAuthMetadataRoutes(input: OAuthRoutesInput): RouteGroup {
  const origin = apiPublicOrigin(input);
  return {
    prefix: '',
    routes: [
      createProtectedResourceMetadataRoute(origin),
      createAuthorizationServerMetadataRoute(origin),
    ],
  };
}

export function createOAuthClientIdentificationRoutes(_input: OAuthRoutesInput): RouteGroup {
  // Validate the same injected value for both factories, even though DCR does
  // not need it yet. This keeps the separately mountable factories consistent.
  apiPublicOrigin(_input);
  return {prefix: '', routes: [createDynamicRegistrationRoute()]};
}

export function createOAuthRoutes(input: OAuthRoutesInput): RouteGroup {
  const origin = apiPublicOrigin(input);
  return {
    prefix: '',
    routes: [
      createProtectedResourceMetadataRoute(origin),
      createAuthorizationServerMetadataRoute(origin),
      createDynamicRegistrationRoute(),
    ],
  };
}

export const createAgentAccessOAuthRoutes = createOAuthRoutes;
