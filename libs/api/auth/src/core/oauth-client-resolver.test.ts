import {describe, expect, it, vi} from '@shipfox/vitest/vi';
import type {AgentClient} from './entities/agent-access.js';
import {InvalidOAuthClientMetadataError} from './errors.js';
import {OAUTH_CIMD_CACHE_MAX_AGE_SECONDS} from './oauth-client.js';
import {
  createOAuthClientResolver,
  OAUTH_CIMD_CACHE_MAX_ENTRIES,
  type ResolvedOAuthClient,
  registerOAuthClient,
} from './oauth-client-resolver.js';

const clientId = 'https://client.example/.well-known/oauth-client';
const redirectUri = 'https://client.example/callback';

function client(overrides: Partial<AgentClient> = {}): AgentClient {
  const now = new Date('2026-09-01T00:00:00.000Z');
  return {
    id: crypto.randomUUID(),
    clientId,
    name: 'Desktop agent',
    redirectUris: [redirectUri],
    kind: 'cimd',
    lastSeenAt: now,
    unreferencedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function fetched(): ResolvedOAuthClient['metadata'] {
  return {
    clientId,
    clientName: 'Desktop agent',
    redirectUris: [redirectUri],
    grantTypes: ['authorization_code'],
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'none',
    scope: 'read',
  };
}

describe('OAuth client resolver', () => {
  it('caches successful CIMD resolution while rate limiting every request', async () => {
    let nowMs = Date.parse('2026-09-01T00:00:00.000Z');
    const findClient = vi.fn(async () => undefined);
    const fetchMetadata = vi.fn(async () => ({metadata: fetched(), cacheMaxAgeSeconds: 60}));
    const upsertCimdClient = vi.fn(async () => client());
    const checkCimdRateLimit = vi.fn(async () => undefined);
    const resolver = createOAuthClientResolver({
      findClient,
      fetchMetadata,
      upsertCimdClient,
      checkCimdRateLimit,
      now: () => new Date(nowMs),
    });

    const first = await resolver.resolve({clientId, requestIp: '198.51.100.10', redirectUri});
    nowMs += 30_000;
    const second = await resolver.resolve({clientId, requestIp: '198.51.100.10', redirectUri});
    nowMs += 31_000;
    const third = await resolver.resolve({clientId, requestIp: '198.51.100.10', redirectUri});

    expect(first).toEqual(second);
    expect(third).not.toEqual(first);
    expect(fetchMetadata).toHaveBeenCalledTimes(2);
    expect(upsertCimdClient).toHaveBeenCalledTimes(2);
    expect(findClient).toHaveBeenCalledTimes(2);
    expect(checkCimdRateLimit).toHaveBeenCalledTimes(3);
  });

  it('does not cache a no-store CIMD response', async () => {
    const findClient = vi.fn(async () => undefined);
    const fetchMetadata = vi.fn(async () => ({metadata: fetched(), cacheMaxAgeSeconds: 0}));
    const resolver = createOAuthClientResolver({
      findClient,
      fetchMetadata,
      upsertCimdClient: async () => client(),
      checkCimdRateLimit: async () => undefined,
    });

    await resolver.resolve({clientId, requestIp: '198.51.100.10'});
    await resolver.resolve({clientId, requestIp: '198.51.100.10'});

    expect(fetchMetadata).toHaveBeenCalledTimes(2);
  });

  it('clamps CIMD cache freshness to the process maximum', async () => {
    let nowMs = Date.parse('2026-09-01T00:00:00.000Z');
    const fetchMetadata = vi.fn(async () => ({metadata: fetched(), cacheMaxAgeSeconds: 999_999}));
    const resolver = createOAuthClientResolver({
      findClient: async () => undefined,
      fetchMetadata,
      upsertCimdClient: async () => client(),
      checkCimdRateLimit: async () => undefined,
      now: () => new Date(nowMs),
    });

    await resolver.resolve({clientId, requestIp: '198.51.100.10'});
    nowMs += (OAUTH_CIMD_CACHE_MAX_AGE_SECONDS + 1) * 1000;
    await resolver.resolve({clientId, requestIp: '198.51.100.10'});

    expect(fetchMetadata).toHaveBeenCalledTimes(2);
  });

  it('bounds the number of cached CIMD clients', async () => {
    const clientIds = Array.from(
      {length: OAUTH_CIMD_CACHE_MAX_ENTRIES + 1},
      (_, index) => `https://client.example/.well-known/oauth-client-${index}`,
    );
    const fetchMetadata = vi.fn(async (resolvedClientId: string) => ({
      metadata: {...fetched(), clientId: resolvedClientId},
      cacheMaxAgeSeconds: 60,
    }));
    const resolver = createOAuthClientResolver({
      findClient: async () => undefined,
      fetchMetadata,
      upsertCimdClient: async (params) => client({clientId: params.clientId}),
      checkCimdRateLimit: async () => undefined,
    });

    for (const resolvedClientId of clientIds) {
      await resolver.resolve({clientId: resolvedClientId, requestIp: '198.51.100.10'});
    }
    const firstClientId = clientIds[0];
    if (firstClientId === undefined) throw new Error('Expected a non-empty client ID list');
    await resolver.resolve({clientId: firstClientId, requestIp: '198.51.100.10'});

    expect(fetchMetadata).toHaveBeenCalledTimes(clientIds.length + 1);
  });

  it('requires a source IP before resolving CIMD metadata', async () => {
    const fetchMetadata = vi.fn();
    const checkCimdRateLimit = vi.fn(async () => undefined);
    const resolver = createOAuthClientResolver({
      findClient: async () => undefined,
      fetchMetadata,
      checkCimdRateLimit,
    });

    await expect(resolver.resolve({clientId})).rejects.toBeInstanceOf(
      InvalidOAuthClientMetadataError,
    );
    expect(fetchMetadata).not.toHaveBeenCalled();
    expect(checkCimdRateLimit).not.toHaveBeenCalled();
  });

  it('returns registered clients without treating opaque IDs as CIMD URLs', async () => {
    const registered = client({clientId: 'client_opaque', kind: 'registered'});
    const fetchMetadata = vi.fn();
    const checkCimdRateLimit = vi.fn(async () => undefined);
    const resolver = createOAuthClientResolver({
      findClient: async () => registered,
      fetchMetadata,
      checkCimdRateLimit,
    });

    const result = await resolver.resolve({
      clientId: registered.clientId,
      requestIp: '198.51.100.10',
      redirectUri,
    });

    expect(result.kind).toBe('registered');
    expect(result.client).toBe(registered);
    expect(fetchMetadata).not.toHaveBeenCalled();
    expect(checkCimdRateLimit).not.toHaveBeenCalled();
  });

  it('rejects a redirect before persisting a fetched client', async () => {
    const upsertCimdClient = vi.fn(async () => client());
    const resolver = createOAuthClientResolver({
      findClient: async () => undefined,
      fetchMetadata: async () => ({metadata: fetched(), cacheMaxAgeSeconds: 60}),
      upsertCimdClient,
      checkCimdRateLimit: async () => undefined,
    });

    await expect(
      resolver.resolve({
        clientId,
        requestIp: '198.51.100.10',
        redirectUri: 'https://client.example/other',
      }),
    ).rejects.toMatchObject({name: 'OAuthRedirectUriNotRegisteredError'});
    expect(upsertCimdClient).not.toHaveBeenCalled();
  });

  it('does not drop explicitly supplied empty registration values', async () => {
    await expect(
      registerOAuthClient({
        clientName: 'Desktop agent',
        redirectUris: [redirectUri],
        scope: '',
      }),
    ).rejects.toBeInstanceOf(InvalidOAuthClientMetadataError);
  });
});
