import {repositoryAuthorizationErrorCodes} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {RepositoryAuthorizerConfigurationError} from './errors.js';

const REPOSITORY_PART_UNSAFE_PATTERN = /[\s/:\\]/u;
const EXTERNAL_REPOSITORY_VALUE_UNSAFE_PATTERN = /\s/u;

export type RepositoryAuthorizationMode = 'selected' | 'all';
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
  | 'repository_not_granted'
  | 'repository_ambiguous'
  | 'authorization_store_unavailable';

export const repositoryAuthorizationClientErrorCodes = {
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
  enabled?: boolean | undefined;
}

export interface RepositoryAuthorizer {
  readonly enabled: boolean;
  resolveRepositoryAuthorization(
    input: ResolveRepositoryAuthorizationInput,
  ): Promise<RepositoryAuthorizationResult | undefined>;
}

export class RepositoryAuthorizationTargetInvalidError extends Error {
  constructor() {
    super('Repository authorization target is invalid');
    this.name = 'RepositoryAuthorizationTargetInvalidError';
  }
}

/**
 * Resolves a repository declaration against local project state. This function
 * accepts only the Projects contract; provider adapters are deliberately not
 * part of the authorization boundary.
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
 * Creates the integration-owned dark-gated authorizer. A disabled authorizer
 * returns `undefined`, allowing its caller to preserve the existing behavior.
 */
export function createRepositoryAuthorizer({
  projects,
  enabled = false,
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

  return {
    enabled: true,
    async resolveRepositoryAuthorization(input) {
      return await resolveRepositoryAuthorization({projects, ...input});
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
    let projectResult: Awaited<ReturnType<ProjectsModuleClient['getProjectBySource']>>;
    try {
      projectResult = await projects.getProjectBySource({
        workspaceId,
        sourceConnectionId: connectionId,
        sourceExternalRepositoryId: repository.externalRepositoryId,
      });
    } catch (error) {
      return storeUnavailable(error, repository.kind);
    }

    return projectResult.project
      ? authorizeProject(projectResult.project)
      : deny('repository_not_granted');
  }

  let projectResult: Awaited<ReturnType<ProjectsModuleClient['findProjectBySourceRepositoryName']>>;
  try {
    projectResult = await projects.findProjectBySourceRepositoryName({
      workspaceId,
      sourceConnectionId: connectionId,
      sourceRepositoryOwner: repository.owner,
      sourceRepositoryName: repository.name,
    });
  } catch (error) {
    return storeUnavailable(error, repository.kind);
  }

  const projectsByRepositoryId = new Map<string, (typeof projectResult.projects)[number]>();
  for (const project of projectResult.projects) {
    if (!projectsByRepositoryId.has(project.sourceExternalRepositoryId)) {
      projectsByRepositoryId.set(project.sourceExternalRepositoryId, project);
    }
  }

  if (projectsByRepositoryId.size === 0) return deny('repository_not_granted');
  if (projectsByRepositoryId.size > 1) return deny('repository_ambiguous');

  const project = projectsByRepositoryId.values().next().value;
  return project ? authorizeProject(project) : deny('repository_not_granted');
}

function storeUnavailable(
  error: unknown,
  targetKind: RepositoryAuthorizationTarget['kind'],
): RepositoryAuthorizationResult {
  if (isCancellationError(error)) throw error;
  logger().error({err: error, targetKind}, 'Repository authorization lookup failed');
  reportError(error, {
    boundary: 'integration.repository-authorization',
    operation: 'resolve-selected',
    tags: {target: targetKind},
  });
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

function authorizeProject(project: {
  id: string;
  sourceExternalRepositoryId: string;
  sourceRepositoryOwner?: string | null | undefined;
  sourceRepositoryName?: string | null | undefined;
}): RepositoryAuthorizationResult {
  return {
    authorized: true,
    repository: {
      externalRepositoryId: project.sourceExternalRepositoryId,
      ...(project.sourceRepositoryOwner == null ? {} : {owner: project.sourceRepositoryOwner}),
      ...(project.sourceRepositoryName == null ? {} : {name: project.sourceRepositoryName}),
    },
    targetProjectId: project.id,
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
    repository.kind === 'external-id'
      ? [repository.kind, repository.externalRepositoryId]
      : [repository.kind, repository.owner.toLowerCase(), repository.name.toLowerCase()],
  ]);
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

function isSafeRepositoryPart(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !REPOSITORY_PART_UNSAFE_PATTERN.test(value) &&
    !containsControlCharacter(value)
  );
}

function isSafeExternalRepositoryValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !EXTERNAL_REPOSITORY_VALUE_UNSAFE_PATTERN.test(value) &&
    !containsControlCharacter(value)
  );
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}
