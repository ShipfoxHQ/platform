import {describe, expect, it} from '@shipfox/vitest/vi';
import {
  oauthAuthorizationServerMetadataSchema,
  oauthClientMetadataDocumentSchema,
  oauthDynamicClientRegistrationRequestSchema,
  oauthProtectedResourceMetadataSchema,
} from './oauth.js';

describe('OAuth metadata schemas', () => {
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
