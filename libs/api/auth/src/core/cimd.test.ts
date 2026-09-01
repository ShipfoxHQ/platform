import {describe, expect, it, vi} from '@shipfox/vitest/vi';
import {type CimdAddress, fetchClientIdMetadata, isPublicUnicastAddress} from './cimd.js';
import {InvalidOAuthClientMetadataError} from './errors.js';

const clientId = 'https://client.example/.well-known/oauth-client';
const publicAddress: CimdAddress = {address: '93.184.216.34', family: 4};
const validDocument = {
  client_id: clientId,
  client_name: 'Desktop agent',
  redirect_uris: ['https://client.example/callback'],
  token_endpoint_auth_method: 'none',
};

function response(document: unknown, headers: Record<string, string | string[] | undefined> = {}) {
  return {
    statusCode: 200,
    headers,
    body: Buffer.from(JSON.stringify(document)),
  };
}

describe('CIMD fetch', () => {
  it('allows global unicast addresses and rejects special-use ranges', () => {
    expect(isPublicUnicastAddress('93.184.216.34', 4)).toBe(true);
    for (const address of [
      '10.0.0.1',
      '127.0.0.1',
      '169.254.1.1',
      '172.16.0.1',
      '192.168.1.1',
      '192.88.99.1',
      '224.0.0.1',
    ]) {
      expect(isPublicUnicastAddress(address, 4)).toBe(false);
    }
    expect(isPublicUnicastAddress('2001:4860:4860::8888', 6)).toBe(true);
    expect(isPublicUnicastAddress('2001:db8::1', 6)).toBe(false);
    expect(isPublicUnicastAddress('fe80::1', 6)).toBe(false);
  });

  it('resolves once and passes the pinned public address to the request', async () => {
    const resolveAddress = vi.fn(async () => [publicAddress]);
    const request = vi.fn((params: {address: CimdAddress}) => {
      expect(params.address).toEqual(publicAddress);
      return Promise.resolve(response(validDocument, {'cache-control': 'max-age=30'}));
    });

    const result = await fetchClientIdMetadata(clientId, {resolveAddress, request});

    expect(resolveAddress).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.metadata).toMatchObject({
      clientId,
      clientName: 'Desktop agent',
      redirectUris: ['https://client.example/callback'],
    });
    expect(result.cacheMaxAgeSeconds).toBe(30);
  });

  it('rejects a DNS answer containing a private or link-local address', async () => {
    const request = vi.fn(async () => response(validDocument));
    await expect(
      fetchClientIdMetadata(clientId, {
        resolveAddress: async () => [publicAddress, {address: '169.254.1.1', family: 4}],
        request,
      }),
    ).rejects.toMatchObject({
      name: 'OAuthMetadataFetchError',
      reason: 'private-address',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects redirects, oversized bodies, malformed JSON, and identity mismatches', async () => {
    await expect(
      fetchClientIdMetadata(clientId, {
        resolveAddress: async () => [publicAddress],
        request: async () => ({
          statusCode: 302,
          headers: {location: 'https://other.example'},
          body: new Uint8Array(),
        }),
      }),
    ).rejects.toMatchObject({name: 'OAuthMetadataFetchError', reason: 'redirected'});

    await expect(
      fetchClientIdMetadata(clientId, {
        resolveAddress: async () => [publicAddress],
        maxBodyBytes: 8,
        request: async () => response(validDocument),
      }),
    ).rejects.toMatchObject({name: 'OAuthMetadataFetchError', reason: 'response-too-large'});

    await expect(
      fetchClientIdMetadata(clientId, {
        resolveAddress: async () => [publicAddress],
        request: async () => ({statusCode: 200, headers: {}, body: Buffer.from('{bad json')}),
      }),
    ).rejects.toBeInstanceOf(InvalidOAuthClientMetadataError);

    await expect(
      fetchClientIdMetadata(clientId, {
        resolveAddress: async () => [publicAddress],
        request: async () =>
          response({...validDocument, client_id: 'https://other.example/.well-known/client'}),
      }),
    ).rejects.toBeInstanceOf(InvalidOAuthClientMetadataError);
  });

  it('does not fetch a credential-bearing client ID', async () => {
    await expect(
      fetchClientIdMetadata('https://user:password@client.example/.well-known/oauth-client', {
        resolveAddress: async () => [publicAddress],
        request: async () => response(validDocument),
      }),
    ).rejects.toBeInstanceOf(InvalidOAuthClientMetadataError);
  });
});
