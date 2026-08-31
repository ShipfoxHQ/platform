import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';

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
  repository_not_granted: 'repository-not-granted',
  repository_ambiguous: 'repository-ambiguous',
  authorization_store_unavailable: 'repository-authorization-unavailable',
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
    return await pending;
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
  const isEnabled = enabled && projects !== undefined;

  return {
    enabled: isEnabled,
    async resolveRepositoryAuthorization(input) {
      if (!isEnabled || !projects) return undefined;
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
  try {
    if (repository.kind === 'external-id') {
      const {project} = await projects.getProjectBySource({
        workspaceId,
        sourceConnectionId: connectionId,
        sourceExternalRepositoryId: repository.externalRepositoryId,
      });

      return project ? authorizeProject(project) : deny('repository_not_granted');
    }

    const {projects: matchedProjects} = await projects.findProjectBySourceRepositoryName({
      workspaceId,
      sourceConnectionId: connectionId,
      sourceRepositoryOwner: repository.owner,
      sourceRepositoryName: repository.name,
    });
    const projectsByRepositoryId = new Map<string, (typeof matchedProjects)[number]>();
    for (const project of matchedProjects) {
      if (!projectsByRepositoryId.has(project.sourceExternalRepositoryId)) {
        projectsByRepositoryId.set(project.sourceExternalRepositoryId, project);
      }
    }

    if (projectsByRepositoryId.size === 0) return deny('repository_not_granted');
    if (projectsByRepositoryId.size > 1) return deny('repository_ambiguous');

    const project = projectsByRepositoryId.values().next().value;
    return project ? authorizeProject(project) : deny('repository_not_granted');
  } catch {
    return deny('authorization_store_unavailable');
  }
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
