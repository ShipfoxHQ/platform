import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {IntegrationConnectionRepositoryGrant} from './entities/repository-grant.js';

export type RepositoryAccessCursor = {
  owner: string;
  name: string;
  externalRepositoryId: string;
};

export type RepositoryAccessOrigin =
  | {type: 'project'; projectId: string; projectName: string}
  | {type: 'manual'; grantId: string};

export type RepositoryAccessRepository = {
  externalRepositoryId: string;
  owner: string;
  name: string;
  origins: RepositoryAccessOrigin[];
};

export interface ListSelectedRepositoryAccessParams {
  connection: {id: string; workspaceId: string};
  projects: ProjectsModuleClient;
  listGrants: (params: {connectionId: string}) => Promise<IntegrationConnectionRepositoryGrant[]>;
  limit: number;
  cursor?: RepositoryAccessCursor | undefined;
}

export interface ListSelectedRepositoryAccessResult {
  repositories: RepositoryAccessRepository[];
  nextCursor: RepositoryAccessCursor | null;
}

type ProjectRepository = Awaited<
  ReturnType<ProjectsModuleClient['listProjectsBySourceConnection']>
>['projects'][number];

type RepositoryAccessCandidate = {
  externalRepositoryId: string;
  owner: string;
  name: string;
  origin: RepositoryAccessOrigin;
};

const MAX_PROJECT_PAGES_PER_REQUEST = 100;

export class RepositoryAccessProjectsPaginationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepositoryAccessProjectsPaginationError';
  }
}

export async function listSelectedRepositoryAccess(
  params: ListSelectedRepositoryAccessParams,
): Promise<ListSelectedRepositoryAccessResult> {
  // A row groups all origins for an external ID. Restart the producer stream
  // for each output page so an origin before the output cursor is not lost
  // when another origin for the same ID sorts after it.
  const projectListInput = {
    workspaceId: params.connection.workspaceId,
    sourceConnectionId: params.connection.id,
    limit: params.limit,
  };
  const [firstProjectPage, grants] = await Promise.all([
    params.projects.listProjectsBySourceConnection(projectListInput),
    params.listGrants({connectionId: params.connection.id}),
  ]);

  const projectRepositories: ProjectRepository[] = [...firstProjectPage.projects];
  let nextProjectCursor = firstProjectPage.nextCursor;
  let projectPagesRead = 1;
  let repositories = repositoriesAfterCursor(
    composeRepositoryAccess(projectRepositories, grants),
    params.cursor,
  );

  while (shouldFetchMore(repositories, nextProjectCursor, params.limit)) {
    if (nextProjectCursor === null) break;
    if (projectPagesRead >= MAX_PROJECT_PAGES_PER_REQUEST) {
      throw new RepositoryAccessProjectsPaginationError(
        `Projects pagination exceeded ${MAX_PROJECT_PAGES_PER_REQUEST} pages`,
      );
    }

    const previousProjectCursor = nextProjectCursor;
    const projectPage = await params.projects.listProjectsBySourceConnection({
      workspaceId: params.connection.workspaceId,
      sourceConnectionId: params.connection.id,
      limit: params.limit,
      cursor: previousProjectCursor,
    });
    if (
      projectPage.nextCursor !== null &&
      compareCursors(projectPage.nextCursor, previousProjectCursor) <= 0
    ) {
      throw new RepositoryAccessProjectsPaginationError(
        'Projects pagination returned a non-advancing cursor',
      );
    }

    projectRepositories.push(...projectPage.projects);
    nextProjectCursor = projectPage.nextCursor;
    projectPagesRead += 1;
    repositories = repositoriesAfterCursor(
      composeRepositoryAccess(projectRepositories, grants),
      params.cursor,
    );
  }

  const page = repositories.slice(0, params.limit);
  const hasMore = repositories.length > params.limit || nextProjectCursor !== null;
  const last = page.at(-1);
  return {
    repositories: page,
    nextCursor: hasMore && last ? repositoryCursor(last) : null,
  };
}

function shouldFetchMore(
  repositories: readonly RepositoryAccessRepository[],
  nextProjectCursor: RepositoryAccessCursor | null,
  limit: number,
): boolean {
  if (nextProjectCursor === null) return false;

  const last = repositories[limit - 1];
  return last === undefined || repositories.length < limit
    ? true
    : compareCursors(nextProjectCursor, repositoryCursor(last)) <= 0;
}

function composeRepositoryAccess(
  projects: readonly ProjectRepository[],
  grants: readonly IntegrationConnectionRepositoryGrant[],
): RepositoryAccessRepository[] {
  const candidatesByRepositoryId = new Map<string, RepositoryAccessCandidate[]>();
  for (const candidate of [
    ...projects.map<RepositoryAccessCandidate>((project) => ({
      externalRepositoryId: project.externalRepositoryId,
      owner: project.owner,
      name: project.name,
      origin: {
        type: 'project',
        projectId: project.projectId,
        projectName: project.projectName,
      },
    })),
    ...grants.map<RepositoryAccessCandidate>((grant) => ({
      externalRepositoryId: grant.externalRepositoryId,
      owner: grant.repositoryOwner,
      name: grant.repositoryName,
      origin: {type: 'manual', grantId: grant.id},
    })),
  ]) {
    const candidates = candidatesByRepositoryId.get(candidate.externalRepositoryId);
    if (candidates) {
      candidates.push(candidate);
    } else {
      candidatesByRepositoryId.set(candidate.externalRepositoryId, [candidate]);
    }
  }

  return [...candidatesByRepositoryId.entries()]
    .map(([externalRepositoryId, candidates]) => {
      const orderedCandidates = [...candidates].sort(compareCandidates);
      // Anchor the row after every known origin so one external ID cannot
      // reappear when another origin has different repository metadata.
      const representative = orderedCandidates.at(-1);
      if (!representative) throw new Error('Repository access candidate group is empty');

      const origins: RepositoryAccessOrigin[] = [];
      for (const candidate of orderedCandidates) {
        if (!origins.some((origin) => sameOrigin(origin, candidate.origin))) {
          origins.push(candidate.origin);
        }
      }
      origins.sort(compareOrigins);

      return {
        externalRepositoryId,
        owner: representative.owner,
        name: representative.name,
        origins,
      };
    })
    .sort(compareRepositories);
}

function compareCandidates(
  left: RepositoryAccessCandidate,
  right: RepositoryAccessCandidate,
): number {
  const cursorComparison = compareCursors(left, right);
  if (cursorComparison !== 0) return cursorComparison;
  return compareOrigins(left.origin, right.origin);
}

function compareRepositories(
  left: RepositoryAccessRepository,
  right: RepositoryAccessRepository,
): number {
  return compareCursors(repositoryCursor(left), repositoryCursor(right));
}

function compareOrigins(left: RepositoryAccessOrigin, right: RepositoryAccessOrigin): number {
  const leftOrder = left.type === 'project' ? 0 : 1;
  const rightOrder = right.type === 'project' ? 0 : 1;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;

  const leftId = left.type === 'project' ? left.projectId : left.grantId;
  const rightId = right.type === 'project' ? right.projectId : right.grantId;
  return compareStrings(leftId, rightId);
}

function sameOrigin(left: RepositoryAccessOrigin, right: RepositoryAccessOrigin): boolean {
  if (left.type === 'project' && right.type === 'project') {
    return left.projectId === right.projectId;
  }
  if (left.type === 'manual' && right.type === 'manual') {
    return left.grantId === right.grantId;
  }
  return false;
}

function repositoriesAfterCursor(
  repositories: readonly RepositoryAccessRepository[],
  cursor: RepositoryAccessCursor | undefined,
): RepositoryAccessRepository[] {
  return repositories.filter((repository) => isAfterCursor(repositoryCursor(repository), cursor));
}

function repositoryCursor(repository: RepositoryAccessRepository): RepositoryAccessCursor {
  return {
    owner: repository.owner,
    name: repository.name,
    externalRepositoryId: repository.externalRepositoryId,
  };
}

function compareCursors(left: RepositoryAccessCursor, right: RepositoryAccessCursor): number {
  const ownerComparison = compareFoldedStrings(left.owner, right.owner);
  if (ownerComparison !== 0) return ownerComparison;
  const nameComparison = compareFoldedStrings(left.name, right.name);
  if (nameComparison !== 0) return nameComparison;
  return compareStrings(left.externalRepositoryId, right.externalRepositoryId);
}

function compareFoldedStrings(left: string, right: string): number {
  return compareStrings(left.toLowerCase(), right.toLowerCase());
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isAfterCursor(
  value: RepositoryAccessCursor,
  cursor: RepositoryAccessCursor | undefined,
): boolean {
  return cursor === undefined || compareCursors(value, cursor) > 0;
}
