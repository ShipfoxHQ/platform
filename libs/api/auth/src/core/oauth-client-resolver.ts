import {
  createAgentClient,
  findAgentClientByClientId,
  upsertCimdAgentClient,
} from '#db/agent-access.js';
import {type FetchedCimdMetadata, fetchClientIdMetadata} from './cimd.js';
import type {AgentClient} from './entities/agent-access.js';
import {InvalidOAuthClientMetadataError} from './errors.js';
import {
  assertOAuthClientMetadataMatchesRequest,
  metadataForAgentClient,
  OAUTH_CIMD_CACHE_MAX_AGE_SECONDS,
  OAUTH_CLIENT_ID_MAX_BYTES,
  type OAuthGrantType,
  type ValidatedOAuthClientMetadata,
  validateOAuthClientId,
  validateOAuthDynamicClientRegistration,
} from './oauth-client.js';
import {checkAuthRateLimit} from './rate-limit.js';

export interface ResolvedOAuthClient {
  client: AgentClient;
  metadata: ValidatedOAuthClientMetadata;
  kind: AgentClient['kind'];
}

export interface ResolveOAuthClientParams {
  clientId: string;
  requestIp?: string | undefined;
  redirectUri?: string | undefined;
  tokenEndpointAuthMethod?: string | undefined;
}

type FetchMetadata = (clientId: string) => Promise<FetchedCimdMetadata>;
type FindClient = (params: {clientId: string}) => Promise<AgentClient | undefined>;
type UpsertCimdClient = (params: {
  clientId: string;
  name: string;
  redirectUris: string[];
}) => Promise<AgentClient>;
type CheckCimdRateLimit = (ip: string) => Promise<void>;

interface CachedCimdClient {
  expiresAt: number;
  resolved: ResolvedOAuthClient;
}

export interface OAuthClientResolver {
  resolve(params: ResolveOAuthClientParams): Promise<ResolvedOAuthClient>;
  clearCache(): void;
}

export interface OAuthClientResolverOptions {
  fetchMetadata?: FetchMetadata;
  findClient?: FindClient;
  upsertCimdClient?: UpsertCimdClient;
  checkCimdRateLimit?: CheckCimdRateLimit;
  now?: () => Date;
}

/** Bounds process-wide CIMD metadata retained between authorization requests. */
export const OAUTH_CIMD_CACHE_MAX_ENTRIES = 1024;

function assertClientIdBounded(clientId: string): void {
  if (
    clientId.length === 0 ||
    clientId.trim() !== clientId ||
    Buffer.byteLength(clientId, 'utf8') > OAUTH_CLIENT_ID_MAX_BYTES
  ) {
    throw new InvalidOAuthClientMetadataError();
  }
}

function normalizedCacheAge(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(Math.floor(seconds), OAUTH_CIMD_CACHE_MAX_AGE_SECONDS);
}

function pruneExpiredCache(cache: Map<string, CachedCimdClient>, nowMs: number): void {
  for (const [clientId, cached] of cache) {
    if (cached.expiresAt <= nowMs) cache.delete(clientId);
  }
}

function cacheCimdClient(
  cache: Map<string, CachedCimdClient>,
  clientId: string,
  cached: CachedCimdClient,
  nowMs: number,
): void {
  pruneExpiredCache(cache, nowMs);
  if (!cache.has(clientId) && cache.size >= OAUTH_CIMD_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(clientId, cached);
}

function registeredMetadata(client: AgentClient): ResolvedOAuthClient {
  return {client, metadata: metadataForAgentClient(client), kind: client.kind};
}

function assertResolvedClientMatchesRequest(
  resolved: ResolvedOAuthClient,
  params: ResolveOAuthClientParams,
): void {
  assertOAuthClientMetadataMatchesRequest({
    metadata: resolved.metadata,
    redirectUri: params.redirectUri,
    tokenEndpointAuthMethod: params.tokenEndpointAuthMethod,
  });
}

async function resolveCachedClient(
  params: ResolveOAuthClientParams,
  cached: CachedCimdClient,
  checkCimdRateLimit: CheckCimdRateLimit,
): Promise<ResolvedOAuthClient> {
  if (params.requestIp === undefined) throw new InvalidOAuthClientMetadataError();
  await checkCimdRateLimit(params.requestIp);
  assertResolvedClientMatchesRequest(cached.resolved, params);
  return cached.resolved;
}

export function createOAuthClientResolver(
  options: OAuthClientResolverOptions = {},
): OAuthClientResolver {
  const cache = new Map<string, CachedCimdClient>();
  const now = options.now ?? (() => new Date());
  const findClient = options.findClient ?? findAgentClientByClientId;
  const fetchMetadata = options.fetchMetadata ?? ((clientId) => fetchClientIdMetadata(clientId));
  const upsertCimdClient = options.upsertCimdClient ?? upsertCimdAgentClient;
  const checkCimdRateLimit =
    options.checkCimdRateLimit ??
    (async (requestIp: string) => {
      await checkAuthRateLimit({
        action: 'oauth-cimd',
        scope: 'ip',
        identifier: requestIp,
        limit: 30,
        windowSeconds: 60 * 60,
      });
    });

  const resolve = async (params: ResolveOAuthClientParams): Promise<ResolvedOAuthClient> => {
    assertClientIdBounded(params.clientId);

    const cached = cache.get(params.clientId);
    if (cached) {
      if (cached.expiresAt > now().getTime()) {
        return await resolveCachedClient(params, cached, checkCimdRateLimit);
      }
      cache.delete(params.clientId);
    }

    const existing = await findClient({clientId: params.clientId});
    if (existing?.kind === 'registered') {
      const resolved = registeredMetadata(existing);
      assertResolvedClientMatchesRequest(resolved, params);
      return resolved;
    }

    if (params.requestIp === undefined) throw new InvalidOAuthClientMetadataError();
    await checkCimdRateLimit(params.requestIp);
    validateOAuthClientId(params.clientId);
    const fetched = await fetchMetadata(params.clientId);
    if (fetched.metadata.clientId !== params.clientId) {
      throw new InvalidOAuthClientMetadataError();
    }
    assertOAuthClientMetadataMatchesRequest({
      metadata: fetched.metadata,
      redirectUri: params.redirectUri,
      tokenEndpointAuthMethod: params.tokenEndpointAuthMethod,
    });
    const client = await upsertCimdClient({
      clientId: fetched.metadata.clientId,
      name: fetched.metadata.clientName,
      redirectUris: fetched.metadata.redirectUris,
    });
    const resolved: ResolvedOAuthClient = {
      client,
      metadata: fetched.metadata,
      kind: 'cimd',
    };
    const cacheAge = normalizedCacheAge(fetched.cacheMaxAgeSeconds);
    if (cacheAge > 0) {
      const nowMs = now().getTime();
      cacheCimdClient(
        cache,
        params.clientId,
        {expiresAt: nowMs + cacheAge * 1000, resolved},
        nowMs,
      );
    }
    return resolved;
  };

  return {
    resolve,
    clearCache: () => cache.clear(),
  };
}

export interface RegisterOAuthClientParams {
  clientName: string;
  redirectUris: string[];
  grantTypes?: OAuthGrantType[] | undefined;
  responseTypes?: 'code'[] | undefined;
  tokenEndpointAuthMethod?: 'none' | undefined;
  scope?: string | undefined;
}

export interface RegisteredOAuthClient {
  client: AgentClient;
  metadata: ValidatedOAuthClientMetadata;
}

export async function registerOAuthClient(
  input: RegisterOAuthClientParams,
): Promise<RegisteredOAuthClient> {
  const validated = validateOAuthDynamicClientRegistration({
    client_name: input.clientName,
    redirect_uris: input.redirectUris,
    ...(input.grantTypes !== undefined ? {grant_types: input.grantTypes} : {}),
    ...(input.responseTypes !== undefined ? {response_types: input.responseTypes} : {}),
    ...(input.tokenEndpointAuthMethod !== undefined
      ? {token_endpoint_auth_method: input.tokenEndpointAuthMethod}
      : {}),
    ...(input.scope !== undefined ? {scope: input.scope} : {}),
  });
  const client = await createAgentClient({
    clientId: `client_${crypto.randomUUID()}`,
    name: validated.clientName,
    redirectUris: validated.redirectUris,
    kind: 'registered',
  });
  return {
    client,
    metadata: {
      clientId: client.clientId,
      ...validated,
    },
  };
}

const defaultOAuthClientResolver = createOAuthClientResolver();

export async function resolveOAuthClient(
  params: ResolveOAuthClientParams,
  resolver: OAuthClientResolver = defaultOAuthClientResolver,
): Promise<ResolvedOAuthClient> {
  return await resolver.resolve(params);
}
