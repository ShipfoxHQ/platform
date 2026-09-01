import {z} from 'zod';

const oauthUrlSchema = z.string().url().max(2048);
const oauthClientNameSchema = z.string().min(1).max(256);
const oauthRedirectUriSchema = z.string().min(1).max(2048);
const oauthScopeSchema = z.string().min(1).max(256);
const oauthGrantTypeSchema = z.enum(['authorization_code', 'refresh_token']);
const oauthResponseTypeSchema = z.literal('code');

/** The only scope exposed by the MCP read-only profile. */
export const OAUTH_READ_SCOPE = 'read' as const;

/** RFC 9728 metadata advertised for the protected MCP resource. */
export const oauthProtectedResourceMetadataSchema = z
  .object({
    resource: oauthUrlSchema,
    authorization_servers: z.array(oauthUrlSchema).min(1),
    scopes_supported: z.array(z.literal(OAUTH_READ_SCOPE)).min(1),
  })
  .strict();

export type OAuthProtectedResourceMetadataDto = z.infer<
  typeof oauthProtectedResourceMetadataSchema
>;

/** RFC 8414 metadata for the MCP authorization server. */
export const oauthAuthorizationServerMetadataSchema = z
  .object({
    issuer: oauthUrlSchema,
    authorization_endpoint: oauthUrlSchema,
    token_endpoint: oauthUrlSchema,
    registration_endpoint: oauthUrlSchema,
    response_types_supported: z.array(oauthResponseTypeSchema).min(1),
    grant_types_supported: z.array(oauthGrantTypeSchema).min(1),
    code_challenge_methods_supported: z.array(z.literal('S256')).min(1),
    token_endpoint_auth_methods_supported: z.array(z.literal('none')).min(1),
    scopes_supported: z.array(z.literal(OAUTH_READ_SCOPE)).min(1),
    client_id_metadata_document_supported: z.literal(true),
  })
  .strict();

export type OAuthAuthorizationServerMetadataDto = z.infer<
  typeof oauthAuthorizationServerMetadataSchema
>;

const oauthRegistrationProfileFields = {
  client_name: oauthClientNameSchema,
  redirect_uris: z.array(oauthRedirectUriSchema).min(1).max(10),
  grant_types: z.array(oauthGrantTypeSchema).min(1).max(2).optional(),
  response_types: z.array(oauthResponseTypeSchema).min(1).max(1).optional(),
  token_endpoint_auth_method: z.literal('none').optional(),
  scope: oauthScopeSchema.optional(),
};

/** RFC 7591 request shape accepted by the MCP public-client profile. */
export const oauthDynamicClientRegistrationRequestSchema = z
  .object(oauthRegistrationProfileFields)
  .strict();

export type OAuthDynamicClientRegistrationRequestDto = z.infer<
  typeof oauthDynamicClientRegistrationRequestSchema
>;

/** RFC 7591 response shape returned for a newly registered public client. */
export const oauthDynamicClientRegistrationResponseSchema = z
  .object({
    client_id: z.string().min(1).max(2048),
    client_name: oauthClientNameSchema,
    redirect_uris: z.array(oauthRedirectUriSchema).min(1).max(10),
    grant_types: z.array(oauthGrantTypeSchema).min(1).max(2),
    response_types: z.array(oauthResponseTypeSchema).min(1).max(1),
    token_endpoint_auth_method: z.literal('none'),
    scope: z.literal(OAUTH_READ_SCOPE),
  })
  .strict();

export type OAuthDynamicClientRegistrationResponseDto = z.infer<
  typeof oauthDynamicClientRegistrationResponseSchema
>;

/**
 * The subset of a Client ID Metadata Document needed before authorization.
 * Optional standard metadata is retained in the schema so a conforming
 * document can be validated without treating unrelated fields as identity.
 */
export const oauthClientMetadataDocumentSchema = z
  .object({
    client_id: z.string().min(1).max(2048),
    client_name: oauthClientNameSchema,
    redirect_uris: z.array(oauthRedirectUriSchema).min(1).max(10),
    grant_types: z.array(oauthGrantTypeSchema).min(1).max(2).optional(),
    response_types: z.array(oauthResponseTypeSchema).min(1).max(1).optional(),
    token_endpoint_auth_method: z.string().min(1).max(128).optional(),
    scope: oauthScopeSchema.optional(),
    client_uri: oauthUrlSchema.optional(),
    logo_uri: oauthUrlSchema.optional(),
    tos_uri: oauthUrlSchema.optional(),
    policy_uri: oauthUrlSchema.optional(),
    jwks_uri: oauthUrlSchema.optional(),
    contacts: z.array(z.string().min(1).max(256)).max(10).optional(),
  })
  .passthrough();

export type OAuthClientMetadataDocumentDto = z.infer<typeof oauthClientMetadataDocumentSchema>;
