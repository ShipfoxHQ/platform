import {z} from 'zod';
import {agentAccessNameSchema} from './agent-access.js';

const oauthUrlSchema = z.string().url().max(2048);
const oauthClientNameSchema = agentAccessNameSchema;
const oauthRedirectUriSchema = z.string().min(1).max(2048);
const oauthScopeSchema = z.string().min(1).max(256);
const oauthGrantTypeSchema = z.enum(['authorization_code', 'refresh_token']);
const oauthResponseTypeSchema = z.literal('code');

/** The only scope exposed by the MCP read-only profile. */
export const OAUTH_READ_SCOPE = 'read' as const;

/** The canonical resource path exposed by the MCP read-only profile. */
export const OAUTH_MCP_RESOURCE_PATH = '/mcp' as const;

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

const utf8Encoder = new TextEncoder();
const utf8ByteLengthAtMost = (value: string, maxBytes: number): boolean =>
  utf8Encoder.encode(value).byteLength <= maxBytes;
const oauthClientIdSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => utf8ByteLengthAtMost(value, 2048));
const oauthStateSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => utf8ByteLengthAtMost(value, 2048));
const oauthCodeChallengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const oauthCodeVerifierSchema = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/u);
const oauthPresentedTokenSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => utf8ByteLengthAtMost(value, 1024));
const oauthRedirectResponseUrlSchema = z.string().url().max(16_384);

/** The validated public request accepted by the OAuth authorization endpoint. */
export const oauthAuthorizeQuerySchema = z
  .object({
    client_id: oauthClientIdSchema,
    response_type: oauthResponseTypeSchema,
    redirect_uri: oauthRedirectUriSchema,
    code_challenge: oauthCodeChallengeSchema,
    code_challenge_method: z.literal('S256'),
    resource: oauthUrlSchema,
    scope: oauthScopeSchema.optional(),
    state: oauthStateSchema.optional(),
  })
  .strict();

export type OAuthAuthorizeQueryDto = z.infer<typeof oauthAuthorizeQuerySchema>;

/** Opaque request id parameters used by the dashboard consent routes. */
export const oauthConsentParamsSchema = z.object({requestId: z.string().min(1).max(128)}).strict();

export type OAuthConsentParamsDto = z.infer<typeof oauthConsentParamsSchema>;

const oauthConsentWorkspaceSchema = z
  .object({
    workspace_id: z.string().uuid(),
    role: z.string().min(1).max(64),
  })
  .strict();

const oauthConsentResponseBaseShape = {
  request_id: z.string().uuid(),
  client_name: oauthClientNameSchema,
  scope: z.literal(OAUTH_READ_SCOPE),
  expires_at: z.string().datetime(),
  redirect_uri_hostname: z.string().min(1).max(253),
  is_loopback_redirect: z.boolean(),
  workspaces: z.array(oauthConsentWorkspaceSchema),
};

/** Detail returned to the authenticated dashboard before a consent decision. */
export const oauthConsentResponseSchema = z.discriminatedUnion('client_identity_kind', [
  z
    .object({
      ...oauthConsentResponseBaseShape,
      client_identity_kind: z.literal('cimd'),
      client_identity_origin: z.string().min(1).max(2048),
    })
    .strict(),
  z
    .object({
      ...oauthConsentResponseBaseShape,
      client_identity_kind: z.literal('self-registered'),
      client_identity_origin: z.null(),
    })
    .strict(),
]);

export type OAuthConsentResponseDto = z.infer<typeof oauthConsentResponseSchema>;

/** Explicit workspace selection required to approve a consent request. */
export const oauthConsentApprovalBodySchema = z.object({workspace_id: z.string().uuid()}).strict();

export type OAuthConsentApprovalBodyDto = z.infer<typeof oauthConsentApprovalBodySchema>;

/** The redirect produced after an approval or denial decision. */
export const oauthConsentDecisionResponseSchema = z
  .object({redirect_url: oauthRedirectResponseUrlSchema})
  .strict();

export type OAuthConsentDecisionResponseDto = z.infer<typeof oauthConsentDecisionResponseSchema>;

/** Public OAuth token request supporting authorization-code and refresh grants. */
export const oauthTokenRequestSchema = z
  .object({
    grant_type: oauthGrantTypeSchema,
    client_id: oauthClientIdSchema,
    scope: oauthScopeSchema.optional(),
    code: oauthPresentedTokenSchema.optional(),
    redirect_uri: oauthRedirectUriSchema.optional(),
    code_verifier: oauthCodeVerifierSchema.optional(),
    refresh_token: oauthPresentedTokenSchema.optional(),
    resource: oauthUrlSchema.optional(),
  })
  .strict();

export type OAuthTokenRequestDto = z.infer<typeof oauthTokenRequestSchema>;

/** RFC 6749 token response for an agent access grant. */
export const oauthTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.literal('Bearer'),
    expires_in: z.number().int().positive(),
    refresh_token: z.string().min(1).optional(),
    scope: z.literal(OAUTH_READ_SCOPE),
  })
  .strict();

export type OAuthTokenResponseDto = z.infer<typeof oauthTokenResponseSchema>;
