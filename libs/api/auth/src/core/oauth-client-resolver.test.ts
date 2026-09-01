import {describe, expect, it, vi} from '@shipfox/vitest/vi';
import type {AgentClient} from './entities/agent-access.js';
import {createOAuthClientResolver, type ResolvedOAuthClient} from './oauth-client-resolver.js';

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

    expect(first).toEqual(second);
    expect(fetchMetadata).toHaveBeenCalledTimes(1);
    expect(upsertCimdClient).toHaveBeenCalledTimes(1);
    expect(findClient).toHaveBeenCalledTimes(1);
    expect(checkCimdRateLimit).toHaveBeenCalledTimes(2);
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

    await resolver.resolve({clientId});
    await resolver.resolve({clientId});

    expect(fetchMetadata).toHaveBeenCalledTimes(2);
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
      resolver.resolve({clientId, redirectUri: 'https://client.example/other'}),
    ).rejects.toMatchObject({name: 'OAuthRedirectUriNotRegisteredError'});
    expect(upsertCimdClient).not.toHaveBeenCalled();
  });
});
