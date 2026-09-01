import {
  OAUTH_READ_SCOPE,
  type OAuthClientMetadataDocumentDto,
  type OAuthDynamicClientRegistrationRequestDto,
  oauthClientMetadataDocumentSchema,
  oauthDynamicClientRegistrationRequestSchema,
} from '@shipfox/api-auth-dto';
import type {AgentClient} from './entities/agent-access.js';
import {
  InvalidOAuthClientMetadataError,
  InvalidOAuthConfigurationError,
  OAuthRedirectUriNotRegisteredError,
} from './errors.js';

const URI_SUFFIX_PATTERN = /[/?#]/u;
const PORT_PATTERN = /^\d+$/u;

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || codePoint === 0x7f;
  });
}

export const OAUTH_CLIENT_ID_MAX_BYTES = 2048;
export const OAUTH_CLIENT_NAME_MAX_BYTES = 256;
export const OAUTH_REDIRECT_URI_MAX_BYTES = 2048;
export const OAUTH_REDIRECT_URI_MAX_COUNT = 10;
export const OAUTH_CIMD_CACHE_MAX_AGE_SECONDS = 15 * 60;

export type OAuthGrantType = 'authorization_code' | 'refresh_token';

export interface ValidatedOAuthClientMetadata {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  grantTypes: OAuthGrantType[];
  responseTypes: ['code'];
  tokenEndpointAuthMethod: 'none';
  scope: typeof OAUTH_READ_SCOPE;
}

function hasByteLengthAtMost(value: string, maxBytes: number): boolean {
  return Buffer.byteLength(value, 'utf8') <= maxBytes;
}

function rejectInvalidMetadata(): never {
  throw new InvalidOAuthClientMetadataError();
}

function rejectInvalidConfiguration(): never {
  throw new InvalidOAuthConfigurationError();
}

function parseUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    return rejectInvalidMetadata();
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function validateUrlShape(url: URL): void {
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.hostname.length === 0 ||
    hasControlCharacter(url.href)
  ) {
    rejectInvalidMetadata();
  }
}

/** Validates an OAuth redirect URI without making network assumptions. */
export function validateOAuthRedirectUri(value: string): URL {
  if (
    !hasByteLengthAtMost(value, OAUTH_REDIRECT_URI_MAX_BYTES) ||
    value.length === 0 ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    return rejectInvalidMetadata();
  }

  const url = parseUrl(value);
  validateUrlShape(url);

  if (url.protocol === 'https:') return url;
  if (url.protocol !== 'http:' || !isLoopbackHostname(url.hostname)) {
    return rejectInvalidMetadata();
  }
  return url;
}

export function isOAuthLoopbackRedirectUri(value: string): boolean {
  try {
    const url = validateOAuthRedirectUri(value);
    return url.protocol === 'http:' && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Redirect URI comparison is byte-for-byte for public HTTPS clients. Only a
 * loopback HTTP client's port may vary, as required by native-app OAuth.
 */
export function oauthRedirectUriMatches(registered: string, requested: string): boolean {
  try {
    const registeredUrl = validateOAuthRedirectUri(registered);
    const requestedUrl = validateOAuthRedirectUri(requested);
    if (registered === requested) return true;
    if (
      registeredUrl.protocol !== 'http:' ||
      requestedUrl.protocol !== 'http:' ||
      !isLoopbackHostname(registeredUrl.hostname) ||
      !isLoopbackHostname(requestedUrl.hostname)
    ) {
      return false;
    }

    return withoutLoopbackPort(registered) === withoutLoopbackPort(requested);
  } catch {
    return false;
  }
}

function withoutLoopbackPort(value: string): string {
  const authorityStart = value.indexOf('//') + 2;
  const suffixOffset = value.slice(authorityStart).search(URI_SUFFIX_PATTERN);
  const authorityEnd = suffixOffset === -1 ? value.length : authorityStart + suffixOffset;
  const authority = value.slice(authorityStart, authorityEnd);

  let authorityWithoutPort = authority;
  if (authority.startsWith('[')) {
    const closingBracket = authority.indexOf(']');
    if (closingBracket !== -1 && PORT_PATTERN.test(authority.slice(closingBracket + 1))) {
      authorityWithoutPort = authority.slice(0, closingBracket + 1);
    }
  } else {
    const colon = authority.lastIndexOf(':');
    if (colon !== -1 && PORT_PATTERN.test(authority.slice(colon + 1))) {
      authorityWithoutPort = authority.slice(0, colon);
    }
  }

  return `${value.slice(0, authorityStart)}${authorityWithoutPort}${value.slice(authorityEnd)}`;
}

export function assertOAuthRedirectUriRegistered(
  redirectUris: readonly string[],
  requested: string,
): void {
  validateOAuthRedirectUri(requested);
  if (!redirectUris.some((registered) => oauthRedirectUriMatches(registered, requested))) {
    throw new OAuthRedirectUriNotRegisteredError();
  }
}

/** Client ID Metadata Documents must be HTTPS URLs with a non-root path. */
export function validateOAuthClientId(value: string): URL {
  if (
    !hasByteLengthAtMost(value, OAUTH_CLIENT_ID_MAX_BYTES) ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    return rejectInvalidMetadata();
  }

  const url = parseUrl(value);
  validateUrlShape(url);
  if (url.protocol !== 'https:' || url.pathname === '/' || url.pathname.length === 0) {
    return rejectInvalidMetadata();
  }
  return url;
}

/** Validates the public origin injected into the dormant route factory. */
export function validateOAuthPublicOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return rejectInvalidConfiguration();
  }

  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))) ||
    value.trim() !== value ||
    hasControlCharacter(value) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.hostname.length === 0
  ) {
    return rejectInvalidConfiguration();
  }
  return url.origin;
}

function validateByteBoundedString(value: string, maxBytes: number): void {
  if (!hasByteLengthAtMost(value, maxBytes) || value.length === 0 || hasControlCharacter(value)) {
    rejectInvalidMetadata();
  }
}

function validateGrantTypes(value: readonly OAuthGrantType[] | undefined): OAuthGrantType[] {
  const grantTypes = [...(value ?? ['authorization_code'])];
  if (
    grantTypes.length === 0 ||
    grantTypes.length > 2 ||
    new Set(grantTypes).size !== grantTypes.length ||
    !grantTypes.includes('authorization_code') ||
    grantTypes.some(
      (grantType) => grantType !== 'authorization_code' && grantType !== 'refresh_token',
    )
  ) {
    rejectInvalidMetadata();
  }
  return grantTypes;
}

function validateResponseTypes(value: readonly 'code'[] | undefined): ['code'] {
  const responseTypes = [...(value ?? ['code'])];
  if (responseTypes.length !== 1 || responseTypes[0] !== 'code') rejectInvalidMetadata();
  return ['code'];
}

function validateScope(value: string | undefined): typeof OAUTH_READ_SCOPE {
  if (value !== undefined && value !== OAUTH_READ_SCOPE) rejectInvalidMetadata();
  return OAUTH_READ_SCOPE;
}

function validateRedirectUris(redirectUris: readonly string[]): string[] {
  if (
    redirectUris.length === 0 ||
    redirectUris.length > OAUTH_REDIRECT_URI_MAX_COUNT ||
    new Set(redirectUris).size !== redirectUris.length
  ) {
    rejectInvalidMetadata();
  }
  for (const redirectUri of redirectUris) validateOAuthRedirectUri(redirectUri);
  return [...redirectUris];
}

function validateTokenEndpointAuthMethod(value: string | undefined): 'none' {
  if (value !== undefined && value !== 'none') rejectInvalidMetadata();
  return 'none';
}

export function validateOAuthDynamicClientRegistration(
  input: OAuthDynamicClientRegistrationRequestDto,
): Omit<ValidatedOAuthClientMetadata, 'clientId'> {
  const parsed = oauthDynamicClientRegistrationRequestSchema.safeParse(input);
  if (!parsed.success) rejectInvalidMetadata();

  const value = parsed.data;
  validateByteBoundedString(value.client_name, OAUTH_CLIENT_NAME_MAX_BYTES);
  return {
    clientName: value.client_name,
    redirectUris: validateRedirectUris(value.redirect_uris),
    grantTypes: validateGrantTypes(value.grant_types),
    responseTypes: validateResponseTypes(value.response_types),
    tokenEndpointAuthMethod: validateTokenEndpointAuthMethod(value.token_endpoint_auth_method),
    scope: validateScope(value.scope),
  };
}

export function validateOAuthClientMetadataDocument(
  input: OAuthClientMetadataDocumentDto,
  fetchedUrl: string,
): ValidatedOAuthClientMetadata {
  const parsed = oauthClientMetadataDocumentSchema.safeParse(input);
  if (!parsed.success || parsed.data.client_id !== fetchedUrl) rejectInvalidMetadata();

  validateOAuthClientId(fetchedUrl);
  const value = parsed.data;
  validateByteBoundedString(value.client_name, OAUTH_CLIENT_NAME_MAX_BYTES);
  return {
    clientId: fetchedUrl,
    clientName: value.client_name,
    redirectUris: validateRedirectUris(value.redirect_uris),
    grantTypes: validateGrantTypes(value.grant_types),
    responseTypes: validateResponseTypes(value.response_types),
    tokenEndpointAuthMethod: validateTokenEndpointAuthMethod(value.token_endpoint_auth_method),
    scope: validateScope(value.scope),
  };
}

export function metadataForAgentClient(client: AgentClient): ValidatedOAuthClientMetadata {
  validateByteBoundedString(client.clientId, OAUTH_CLIENT_ID_MAX_BYTES);
  validateByteBoundedString(client.name, OAUTH_CLIENT_NAME_MAX_BYTES);
  validateRedirectUris(client.redirectUris);
  return {
    clientId: client.clientId,
    clientName: client.name,
    redirectUris: [...client.redirectUris],
    grantTypes: ['authorization_code'],
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'none',
    scope: OAUTH_READ_SCOPE,
  };
}

export function assertOAuthClientMetadataMatchesRequest(params: {
  metadata: ValidatedOAuthClientMetadata;
  redirectUri?: string | undefined;
  tokenEndpointAuthMethod?: string | undefined;
}): void {
  if (params.redirectUri !== undefined) {
    assertOAuthRedirectUriRegistered(params.metadata.redirectUris, params.redirectUri);
  }
  validateTokenEndpointAuthMethod(params.tokenEndpointAuthMethod);
}
