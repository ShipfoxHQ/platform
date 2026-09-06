import {describe, expect, it} from '@shipfox/vitest/vi';
import {
  oauthAuthorizationServerMetadataSchema,
  oauthAuthorizeQuerySchema,
  oauthClientMetadataDocumentSchema,
  oauthConsentResponseSchema,
  oauthDynamicClientRegistrationRequestSchema,
  oauthProtectedResourceMetadataSchema,
} from './oauth.js';

describe('OAuth metadata schemas', () => {
  it('requires a non-empty authorization state when it is supplied', () => {
    expect(
      oauthAuthorizeQuerySchema.safeParse({
        client_id: 'client-id',
        response_type: 'code',
        redirect_uri: 'https://client.example/callback',
        code_challenge: 'a'.repeat(43),
        code_challenge_method: 'S256',
        resource: 'https://api.example.test/mcp',
        state: '',
      }).success,
    ).toBe(false);
  });

  it('accepts the MCP read-only discovery profile', () => {
    expect(
      oauthProtectedResourceMetadataSchema.safeParse({
        resource: 'https://api.example.test/mcp',
        authorization_servers: ['https://api.example.test'],
        scopes_supported: ['read'],
      }).success,
    ).toBe(true);

    expect(
      oauthAuthorizationServerMetadataSchema.safeParse({
        issuer: 'https://api.example.test',
        authorization_endpoint: 'https://api.example.test/oauth/authorize',
        token_endpoint: 'https://api.example.test/oauth/token',
        registration_endpoint: 'https://api.example.test/oauth/register',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['read'],
        client_id_metadata_document_supported: true,
      }).success,
    ).toBe(true);
  });

  it('requires consent identity fields to match their discriminator', () => {
    const detail = {
      request_id: '11111111-1111-4111-8111-111111111111',
      client_name: 'Desktop agent',
      scope: 'read',
      expires_at: '2026-09-05T12:00:00.000Z',
      redirect_uri_hostname: 'client.example',
      is_loopback_redirect: false,
      workspaces: [],
    };

    expect(
      oauthConsentResponseSchema.safeParse({
        ...detail,
        client_identity_kind: 'cimd',
        client_identity_origin: 'https://client.example',
      }).success,
    ).toBe(true);
    expect(
      oauthConsentResponseSchema.safeParse({
        ...detail,
        client_identity_kind: 'self-registered',
        client_identity_origin: null,
      }).success,
    ).toBe(true);
    expect(
      oauthConsentResponseSchema.safeParse({
        ...detail,
        client_identity_kind: 'self-registered',
        client_identity_origin: 'https://client.example',
      }).success,
    ).toBe(false);
  });

  it('requires the bounded public-client registration fields', () => {
    expect(
      oauthDynamicClientRegistrationRequestSchema.safeParse({
        client_name: 'Desktop agent',
        redirect_uris: ['http://127.0.0.1:43123/callback'],
      }).success,
    ).toBe(true);

    expect(
      oauthDynamicClientRegistrationRequestSchema.safeParse({
        client_name: 'Desktop agent',
        redirect_uris: [],
      }).success,
    ).toBe(false);
    expect(
      oauthDynamicClientRegistrationRequestSchema.safeParse({
        client_name: 'Desktop agent',
        redirect_uris: ['https://client.example/callback'],
        token_endpoint_auth_method: 'client_secret_basic',
      }).success,
    ).toBe(false);
  });

  it('accepts standard optional CIMD fields without changing the identity fields', () => {
    const result = oauthClientMetadataDocumentSchema.safeParse({
      client_id: 'https://client.example/.well-known/oauth-client',
      client_name: 'Desktop agent',
      redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none',
      client_uri: 'https://client.example',
      contacts: ['security@client.example'],
      custom_metadata: 'ignored by the profile',
    });

    expect(result.success).toBe(true);
  });
});
