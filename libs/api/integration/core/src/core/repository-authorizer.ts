import {
  isSafeExternalRepositoryValue,
  isSafeRepositoryPart,
} from '@shipfox/api-integration-core-dto';
import {repositoryAuthorizationErrorCodes} from '@shipfox/api-integration-core-dto/inter-module';
import type {IntegrationConnectionRepositoryAccessMode} from '@shipfox/api-integration-spi';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {RepositoryAuthorizerConfigurationError} from './errors.js';

// Keep every outage retryable while bounding the Sentry volume process-wide.
const REPOSITORY_AUTHORIZATION_REPORT_INTERVAL_MS = 60_000;
const REPOSITORY_AUTHORIZATION_CACHE_TTL_MS = 30_000;
const DEFAULT_REPOSITORY_AUTHORIZATION_CACHE_SIZE = 256;
let lastRepositoryAuthorizationReportAt = Number.NEGATIVE_INFINITY;

export type RepositoryAuthorizationMode = IntegrationConnectionRepositoryAccessMode;
export type RepositoryAuthorizationCapability = 'checkout' | 'tools';

export interface RepositoryAuthorizationExternalIdTarget {
  kind: 'external-id';
  externalRepositoryId: string;
}

export interface RepositoryAuthorizationNameTarget {
  kind: 'name';
  owner: string;
  name: string;
}

export type RepositoryAuthorizationTarget =
  | RepositoryAuthorizationExternalIdTarget
  | RepositoryAuthorizationNameTarget;

export type RepositoryAuthorizationDenial =
  | 'repository_required'
  | 'repository_not_granted'
  | 'repository_ambiguous'
  | 'authorization_store_unavailable';

export const repositoryAuthorizationClientErrorCodes = {
  repository_required: repositoryAuthorizationErrorCodes.required,
  repository_not_granted: repositoryAuthorizationErrorCodes.notGranted,
  repository_ambiguous: repositoryAuthorizationErrorCodes.ambiguous,
  authorization_store_unavailable: repositoryAuthorizationErrorCodes.storeUnavailable,
} as const satisfies Record<RepositoryAuthorizationDenial, string>;

export type RepositoryAuthorizationClientErrorCode =
  (typeof repositoryAuthorizationClientErrorCodes)[RepositoryAuthorizationDenial];

export function repositoryAuthorizationClientErrorCode(
  reason: RepositoryAuthorizationDenial,
): RepositoryAuthorizationClientErrorCode {
  return repositoryAuthorizationClientErrorCodes[reason];
}

export interface AuthorizedRepository {
  externalRepositoryId?: string | undefined;
  owner?: string | undefined;
  name?: string | undefined;
}

export type RepositoryAuthorizationResult =
  | {
      authorized: true;
      repository: AuthorizedRepository;
      targetProjectId?: string | undefined;
    }
  | {authorized: false; reason: RepositoryAuthorizationDenial};

export interface RepositoryAuthorizationRequestContext {
  readonly memo: Map<string, Promise<RepositoryAuthorizationResult>>;
}

export function createRepositoryAuthorizationRequestContext(): RepositoryAuthorizationRequestContext {
  return {memo: new Map()};
}

export interface ResolveRepositoryAuthorizationInput {
  workspaceId: string;
  connectionId: string;
  /** The `all` mode may only originate from trusted server-side authorization state. */
  mode: RepositoryAuthorizationMode;
  repository: RepositoryAuthorizationTarget;
  capability: RepositoryAuthorizationCapability;
  request?: RepositoryAuthorizationRequestContext | undefined;
}

export interface ResolveRepositoryAuthorizationParams extends ResolveRepositoryAuthorizationInput {
  projects: ProjectsModuleClient;
}

export interface CreateRepositoryAuthorizerOptions {
  projects?: ProjectsModuleClient | undefined;
  /** Every composition must explicitly choose whether authorization is enabled. */
  enabled: boolean;
  now?: (() => number) | undefined;
  maxCacheEntries?: number | undefined;
}

export interface RepositoryAuthorizer {
  readonly enabled: boolean;
  resolveRepositoryAuthorization(
    input: ResolveRepositoryAuthorizationInput,
  ): Promise<RepositoryAuthorizationResult | undefined>;
  invalidateRepositoryAuthorizationCache?: (connectionId: string) => void;
}

export class RepositoryAuthorizationTargetInvalidError extends Error {
  constructor() {
    super('Repository authorization target is invalid');
    this.name = 'RepositoryAuthorizationTargetInvalidError';
  }
}

/**
 * Resolves a repository declaration against local project state. Provider
 * adapters are deliberately not part of the authorization boundary.
 */
export async function resolveRepositoryAuthorization({
  projects,
  request,
  ...input
}: ResolveRepositoryAuthorizationParams): Promise<RepositoryAuthorizationResult> {
  assertValidTarget(input.repository, input.mode);

  if (input.mode === 'all') {
    return authorizeAllMode(input.repository);
  }

  const resolve = () => resolveSelectedMode({projects, ...input});
  if (!request) return await resolve();

  const key = authorizationMemoKey(input);
  const cached = request.memo.get(key);
  if (cached) return await cached;

  const pending = resolve();
  request.memo.set(key, pending);
  try {
    const result = await pending;
    if (
      !result.authorized &&
      result.reason === 'authorization_store_unavailable' &&
      request.memo.get(key) === pending
    ) {
      request.memo.delete(key);
    }
    return result;
  } catch (error) {
    if (request.memo.get(key) === pending) request.memo.delete(key);
    throw error;
  }
}

/**
 * Creates the integration-owned authorizer. The required `enabled` option keeps
 * the disabled test seam explicit. A disabled authorizer returns `undefined`,
 * allowing test callers to preserve the pre-enforcement behavior.
 */
export function createRepositoryAuthorizer({
  projects,
  enabled,
  now = Date.now,
  maxCacheEntries = DEFAULT_REPOSITORY_AUTHORIZATION_CACHE_SIZE,
}: CreateRepositoryAuthorizerOptions): RepositoryAuthorizer {
  if (!enabled) {
    return {
      enabled: false,
      resolveRepositoryAuthorization() {
        return Promise.resolve(undefined);
      },
    };
  }
  if (!projects) throw new RepositoryAuthorizerConfigurationError();

  const cache = createSharedAuthorizationCache({now, maxCacheEntries});

  return {
    enabled: true,
    async resolveRepositoryAuthorization(input) {
      assertValidTarget(input.repository, input.mode);
      if (input.mode === 'all') {
        return await resolveRepositoryAuthorization({projects, ...input});
      }

      const key = authorizationSharedCacheKey(input);
      const cached = cache.get(key);
      if (cached) return cloneAuthorizationResult(cached);

      const generation = cache.generation();
      const result = await resolveRepositoryAuthorization({projects, ...input});
      if (result.authorized && cache.generation() === generation) {
        cache.set(key, input.connectionId, result);
      }
      return result;
    },
    invalidateRepositoryAuthorizationCache(connectionId) {
      cache.invalidate(connectionId);
    },
  };
}

async function resolveSelectedMode({
  projects,
  workspaceId,
  connectionId,
  repository,
}: Pick<
  ResolveRepositoryAuthorizationParams,
  'projects' | 'workspaceId' | 'connectionId' | 'repository'
>): Promise<RepositoryAuthorizationResult> {
  if (repository.kind === 'external-id') {
    try {
      const projectResult = await projects.getProjectBySource({
        workspaceId,
        sourceConnectionId: connectionId,
        sourceExternalRepositoryId: repository.externalRepositoryId,
      });

      const candidates = new Map<string, RepositoryAuthorizationCandidate>();
      if (projectResult.project)
        addCandidate(candidates, projectToCandidate(projectResult.project));
      return authorizeCandidates(candidates);
    } catch (error) {
      return storeUnavailable(error, repository.kind);
    }
  }

  try {
    const projectResult = await projects.findProjectBySourceRepositoryName({
      workspaceId,
      sourceConnectionId: connectionId,
      sourceRepositoryOwner: repository.owner,
      sourceRepositoryName: repository.name,
    });

    const candidates = new Map<string, RepositoryAuthorizationCandidate>();
    for (const project of projectResult.projects) {
      addCandidate(candidates, projectToCandidate(project));
    }
    return authorizeCandidates(candidates);
  } catch (error) {
    return storeUnavailable(error, repository.kind);
  }
}

function storeUnavailable(
  error: unknown,
  targetKind: RepositoryAuthorizationTarget['kind'],
): RepositoryAuthorizationResult {
  if (isCancellationError(error)) throw error;
  logger().error({err: error, targetKind}, 'Repository authorization lookup failed');
  const now = Date.now();
  if (now - lastRepositoryAuthorizationReportAt >= REPOSITORY_AUTHORIZATION_REPORT_INTERVAL_MS) {
    const eventId = reportError(error, {
      boundary: 'integration.repository-authorization',
      operation: 'resolve-selected',
      tags: {target: targetKind},
    });
    if (eventId) lastRepositoryAuthorizationReportAt = now;
  }
  return deny('authorization_store_unavailable');
}

function isCancellationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      error.name === 'CanceledError' ||
      error.name === 'CancelledError')
  );
}

function authorizeAllMode(
  repository: RepositoryAuthorizationTarget,
): RepositoryAuthorizationResult {
  if (repository.kind === 'external-id') {
    return {
      authorized: true,
      repository: {externalRepositoryId: repository.externalRepositoryId},
    };
  }
  return {
    authorized: true,
    repository: {owner: repository.owner, name: repository.name},
  };
}

interface RepositoryAuthorizationCandidate {
  externalRepositoryId: string;
  owner?: string | undefined;
  name?: string | undefined;
  targetProjectId?: string | undefined;
}

function projectToCandidate(project: {
  id: string;
  sourceExternalRepositoryId: string;
  sourceRepositoryOwner?: string | null | undefined;
  sourceRepositoryName?: string | null | undefined;
}): RepositoryAuthorizationCandidate {
  return {
    externalRepositoryId: project.sourceExternalRepositoryId,
    ...(project.sourceRepositoryOwner == null ? {} : {owner: project.sourceRepositoryOwner}),
    ...(project.sourceRepositoryName == null ? {} : {name: project.sourceRepositoryName}),
    targetProjectId: project.id,
  };
}

function addCandidate(
  candidates: Map<string, RepositoryAuthorizationCandidate>,
  candidate: RepositoryAuthorizationCandidate,
): void {
  const existing = candidates.get(candidate.externalRepositoryId);
  if (!existing) {
    candidates.set(candidate.externalRepositoryId, candidate);
    return;
  }

  candidates.set(candidate.externalRepositoryId, {
    externalRepositoryId: candidate.externalRepositoryId,
    owner: existing.owner ?? candidate.owner,
    name: existing.name ?? candidate.name,
    targetProjectId: existing.targetProjectId ?? candidate.targetProjectId,
  });
}

function authorizeCandidates(
  candidates: Map<string, RepositoryAuthorizationCandidate>,
): RepositoryAuthorizationResult {
  if (candidates.size === 0) return deny('repository_not_granted');
  if (candidates.size > 1) return deny('repository_ambiguous');

  const candidate = candidates.values().next().value;
  if (!candidate) return deny('repository_not_granted');

  return {
    authorized: true,
    repository: {
      externalRepositoryId: candidate.externalRepositoryId,
      ...(candidate.owner === undefined ? {} : {owner: candidate.owner}),
      ...(candidate.name === undefined ? {} : {name: candidate.name}),
    },
    ...(candidate.targetProjectId === undefined
      ? {}
      : {targetProjectId: candidate.targetProjectId}),
  };
}

function deny(reason: RepositoryAuthorizationDenial): RepositoryAuthorizationResult {
  return {authorized: false, reason};
}

function authorizationMemoKey({
  workspaceId,
  connectionId,
  mode,
  capability,
  repository,
}: ResolveRepositoryAuthorizationInput): string {
  return JSON.stringify([
    workspaceId,
    connectionId,
    mode,
    capability,
    normalizedRepositoryTarget(repository),
  ]);
}

function authorizationSharedCacheKey({
  connectionId,
  mode,
  repository,
}: Pick<ResolveRepositoryAuthorizationInput, 'connectionId' | 'mode' | 'repository'>): string {
  return JSON.stringify([connectionId, mode, normalizedRepositoryTarget(repository)]);
}

function normalizedRepositoryTarget(
  repository: RepositoryAuthorizationTarget,
): readonly [string, ...string[]] {
  return repository.kind === 'external-id'
    ? [repository.kind, repository.externalRepositoryId]
    : [repository.kind, repository.owner.toLowerCase(), repository.name.toLowerCase()];
}

type AuthorizedRepositoryAuthorizationResult = Extract<
  RepositoryAuthorizationResult,
  {authorized: true}
>;

function cloneAuthorizationResult(
  result: AuthorizedRepositoryAuthorizationResult,
): AuthorizedRepositoryAuthorizationResult {
  return {
    authorized: true,
    repository: {...result.repository},
    ...(result.targetProjectId === undefined ? {} : {targetProjectId: result.targetProjectId}),
  };
}

function createSharedAuthorizationCache({
  now,
  maxCacheEntries,
}: {
  now: () => number;
  maxCacheEntries: number;
}): {
  get(key: string): AuthorizedRepositoryAuthorizationResult | undefined;
  set(key: string, connectionId: string, result: AuthorizedRepositoryAuthorizationResult): void;
  generation(): number;
  invalidate(connectionId: string): void;
} {
  const entries = new Map<
    string,
    {
      connectionId: string;
      expiresAt: number;
      result: AuthorizedRepositoryAuthorizationResult;
    }
  >();
  let invalidationGeneration = 0;
  const capacity =
    Number.isSafeInteger(maxCacheEntries) && maxCacheEntries > 0
      ? maxCacheEntries
      : DEFAULT_REPOSITORY_AUTHORIZATION_CACHE_SIZE;

  function removeExpired(currentTime: number): void {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(key);
    }
  }

  return {
    get(key) {
      const currentTime = now();
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= currentTime) {
        entries.delete(key);
        return undefined;
      }
      return entry.result;
    },
    set(key, connectionId, result) {
      removeExpired(now());
      entries.delete(key);
      entries.set(key, {
        connectionId,
        expiresAt: now() + REPOSITORY_AUTHORIZATION_CACHE_TTL_MS,
        result: cloneAuthorizationResult(result),
      });
      while (entries.size > capacity) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    generation() {
      return invalidationGeneration;
    },
    invalidate(connectionId) {
      invalidationGeneration += 1;
      for (const [key, entry] of entries) {
        if (entry.connectionId === connectionId) entries.delete(key);
      }
    },
  };
}

function assertValidTarget(
  repository: RepositoryAuthorizationTarget,
  mode: RepositoryAuthorizationMode,
): void {
  if (!repository || typeof repository !== 'object') {
    throw new RepositoryAuthorizationTargetInvalidError();
  }

  if (repository.kind === 'external-id') {
    if (typeof repository.externalRepositoryId !== 'string') {
      throw new RepositoryAuthorizationTargetInvalidError();
    }
    const separatorIndex = repository.externalRepositoryId.indexOf(':');
    const namespace = repository.externalRepositoryId.slice(0, separatorIndex);
    const value = repository.externalRepositoryId.slice(separatorIndex + 1);
    if (mode === 'selected') {
      if (!isSafeExternalRepositoryValue(repository.externalRepositoryId)) {
        throw new RepositoryAuthorizationTargetInvalidError();
      }
      return;
    }
    if (
      separatorIndex <= 0 ||
      !isSafeRepositoryPart(namespace) ||
      !isSafeExternalRepositoryValue(value)
    ) {
      throw new RepositoryAuthorizationTargetInvalidError();
    }
    return;
  }

  if (
    repository.kind !== 'name' ||
    !isSafeRepositoryPart(repository.owner) ||
    !isSafeRepositoryPart(repository.name)
  ) {
    throw new RepositoryAuthorizationTargetInvalidError();
  }
}
