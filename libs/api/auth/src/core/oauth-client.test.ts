import {describe, expect, it} from '@shipfox/vitest/vi';
import {
  InvalidOAuthClientMetadataError,
  InvalidOAuthConfigurationError,
  OAuthRedirectUriNotRegisteredError,
} from './errors.js';
import {
  assertOAuthClientMetadataMatchesRequest,
  assertOAuthRedirectUriRegistered,
  oauthRedirectUriMatches,
  validateOAuthClientId,
  validateOAuthClientMetadataDocument,
  validateOAuthDynamicClientRegistration,
  validateOAuthPublicOrigin,
  validateOAuthRedirectUri,
} from './oauth-client.js';

describe('OAuth client validation', () => {
  it('accepts HTTPS redirects and loopback HTTP redirects', () => {
    expect(validateOAuthRedirectUri('https://client.example/callback').protocol).toBe('https:');
    expect(validateOAuthRedirectUri('http://localhost:43123/callback').hostname).toBe('localhost');
    expect(validateOAuthRedirectUri('http://127.0.0.1/callback').hostname).toBe('127.0.0.1');
    expect(validateOAuthRedirectUri('http://[::1]:43123/callback').hostname).toBe('[::1]');
  });

  it('allows only a loopback port variation during redirect matching', () => {
    expect(
      oauthRedirectUriMatches('http://127.0.0.1:43123/callback', 'http://127.0.0.1:51999/callback'),
    ).toBe(true);
    expect(
      oauthRedirectUriMatches('http://[::1]:43123/callback', 'http://[::1]:51999/callback'),
    ).toBe(true);
    expect(
      oauthRedirectUriMatches('http://127.0.0.1:43123/callback', 'http://127.0.0.1:51999/other'),
    ).toBe(false);
    expect(
      oauthRedirectUriMatches(
        'http://localhost:43123/callback',
        'http://localhost:51999/./callback',
      ),
    ).toBe(false);
    expect(
      oauthRedirectUriMatches(
        'https://client.example/callback',
        'https://client.example:443/callback',
      ),
    ).toBe(false);
  });

  it('rejects private-use and non-loopback HTTP redirect schemes', () => {
    for (const value of [
      'http://client.example/callback',
      'com.example.app:/oauth/callback',
      'https://client.example/callback#fragment',
      'https://user:password@client.example/callback',
    ]) {
      expect(() => validateOAuthRedirectUri(value)).toThrow(InvalidOAuthClientMetadataError);
    }
  });

  it('rejects redirect hostnames longer than the DNS hostname limit', () => {
    expect(() => validateOAuthRedirectUri(`https://${'a'.repeat(254)}/callback`)).toThrow(
      InvalidOAuthClientMetadataError,
    );
  });

  it('requires CIMD client IDs to be HTTPS URLs with a path', () => {
    expect(validateOAuthClientId('https://client.example/.well-known/oauth-client').pathname).toBe(
      '/.well-known/oauth-client',
    );
    for (const value of ['https://client.example', 'http://client.example/oauth-client']) {
      expect(() => validateOAuthClientId(value)).toThrow(InvalidOAuthClientMetadataError);
    }
  });

  it('normalizes and validates the injected API origin', () => {
    expect(validateOAuthPublicOrigin('https://api.example.test/')).toBe('https://api.example.test');
    expect(validateOAuthPublicOrigin('http://localhost:3000/')).toBe('http://localhost:3000');
    expect(() => validateOAuthPublicOrigin('https://api.example.test/v1')).toThrow(
      InvalidOAuthConfigurationError,
    );
  });

  it('validates registration bounds and the CIMD identity contract', () => {
    const registration = validateOAuthDynamicClientRegistration({
      client_name: 'Desktop agent',
      redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none',
      scope: 'read',
    });
    expect(registration).toMatchObject({
      clientName: 'Desktop agent',
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
    });

    expect(() =>
      validateOAuthDynamicClientRegistration({
        client_name: 'Desktop agent',
        redirect_uris: ['https://client.example/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
      }),
    ).toThrow(InvalidOAuthClientMetadataError);

    expect(() =>
      validateOAuthDynamicClientRegistration({
        client_name: 'é'.repeat(200),
        redirect_uris: ['https://client.example/callback'],
      }),
    ).toThrow(InvalidOAuthClientMetadataError);

    expect(() =>
      validateOAuthClientMetadataDocument(
        {
          client_id: 'https://client.example/.well-known/oauth-client',
          client_name: 'Desktop agent',
          redirect_uris: ['https://client.example/callback'],
          token_endpoint_auth_method: 'client_secret_basic',
        },
        'https://client.example/.well-known/oauth-client',
      ),
    ).toThrow(InvalidOAuthClientMetadataError);

    expect(() =>
      validateOAuthClientMetadataDocument(
        {
          client_id: 'https://other.example/.well-known/oauth-client',
          client_name: 'Desktop agent',
          redirect_uris: ['https://client.example/callback'],
        },
        'https://client.example/.well-known/oauth-client',
      ),
    ).toThrow(InvalidOAuthClientMetadataError);
  });

  it('checks redirect membership and public-client authentication', () => {
    const metadata = validateOAuthDynamicClientRegistration({
      client_name: 'Desktop agent',
      redirect_uris: ['http://127.0.0.1:43123/callback'],
    });
    const clientMetadata = {
      clientId: 'client_123',
      ...metadata,
    };

    expect(() =>
      assertOAuthClientMetadataMatchesRequest({
        metadata: clientMetadata,
        redirectUri: 'http://127.0.0.1:43124/callback',
      }),
    ).not.toThrow();
    expect(() =>
      assertOAuthRedirectUriRegistered(metadata.redirectUris, 'https://other.example/callback'),
    ).toThrow(OAuthRedirectUriNotRegisteredError);
    expect(() =>
      assertOAuthClientMetadataMatchesRequest({
        metadata: clientMetadata,
        tokenEndpointAuthMethod: 'client_secret_basic',
      }),
    ).toThrow(InvalidOAuthClientMetadataError);
  });
});
