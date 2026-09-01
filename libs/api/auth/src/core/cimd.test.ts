import {describe, expect, it, vi} from '@shipfox/vitest/vi';
import {
  type CimdAddress,
  type CimdHttpResponse,
  fetchClientIdMetadata,
  isPublicUnicastAddress,
} from './cimd.js';
import {InvalidOAuthClientMetadataError} from './errors.js';

const clientId = 'https://client.example/.well-known/oauth-client';
const publicAddress: CimdAddress = {address: '93.184.216.34', family: 4};
const validDocument = {
  client_id: clientId,
  client_name: 'Desktop agent',
  redirect_uris: ['https://client.example/callback'],
  token_endpoint_auth_method: 'none',
};

function response(
  document: unknown,
  headers: Record<string, string | string[] | undefined> = {},
  statusCode = 200,
) {
  return {
    statusCode,
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
    for (const address of ['2002:0a00:0001::1', '::ffff:10.0.0.1', '::', '1::2::3']) {
      expect(isPublicUnicastAddress(address, 6)).toBe(false);
    }
    expect(isPublicUnicastAddress('fe80::1%eth0', 6)).toBe(false);
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

  it('honors cache directives and rejects invalid response headers', async () => {
    const cacheCases = [
      ['no-store', 0],
      ['no-cache', 0],
      ['max-age = 0', 0],
      ['max-age=30', 30],
      ['max-age=999999', 900],
      ['max-age=not-a-number', 900],
      [undefined, 900],
    ] as const;

    for (const [cacheControl, expectedMaxAge] of cacheCases) {
      const headers = cacheControl === undefined ? {} : {'cache-control': cacheControl};
      const result = await fetchClientIdMetadata(clientId, {
        resolveAddress: async () => [publicAddress],
        request: async () => response(validDocument, headers),
      });
      expect(result.cacheMaxAgeSeconds).toBe(expectedMaxAge);
    }

    await expect(
      fetchClientIdMetadata(clientId, {
        resolveAddress: async () => [publicAddress],
        request: async () => response(validDocument, {'content-length': '9'}),
        maxBodyBytes: 8,
      }),
    ).rejects.toMatchObject({name: 'OAuthMetadataFetchError', reason: 'response-too-large'});

    await expect(
      fetchClientIdMetadata(clientId, {
        resolveAddress: async () => [publicAddress],
        request: async () => response(validDocument, {'content-encoding': 'gzip'}),
      }),
    ).rejects.toMatchObject({name: 'OAuthMetadataFetchError', reason: 'invalid-response'});

    await expect(
      fetchClientIdMetadata(clientId, {
        resolveAddress: async () => [publicAddress],
        request: async () => response(validDocument, {}, 500),
      }),
    ).rejects.toMatchObject({name: 'OAuthMetadataFetchError', reason: 'invalid-response'});
  });

  it('tries the next validated address after a connection failure', async () => {
    const secondAddress: CimdAddress = {address: '93.184.216.35', family: 4};
    const request = vi.fn(({address}: {address: CimdAddress}) => {
      if (address === publicAddress) return Promise.reject(new Error('connection refused'));
      return Promise.resolve(response(validDocument));
    });

    await expect(
      fetchClientIdMetadata(clientId, {
        resolveAddress: async () => [publicAddress, secondAddress],
        request,
      }),
    ).resolves.toMatchObject({metadata: {clientId}});
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({address: secondAddress}));
  });

  it('aborts an in-flight request when the overall timeout expires', async () => {
    let signal: AbortSignal | undefined;
    const request = vi.fn(
      ({signal: requestSignal}: {signal?: AbortSignal}) =>
        new Promise<CimdHttpResponse>((_resolve, reject) => {
          signal = requestSignal;
          requestSignal?.addEventListener('abort', () => reject(new Error('request aborted')), {
            once: true,
          });
        }),
    );

    await expect(
      fetchClientIdMetadata(clientId, {
        resolveAddress: async () => [publicAddress],
        request,
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({name: 'OAuthMetadataFetchError', reason: 'timeout'});
    expect(signal?.aborted).toBe(true);
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
