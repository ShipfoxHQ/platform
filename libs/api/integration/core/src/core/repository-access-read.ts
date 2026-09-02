import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';

export type RepositoryAccessCursor = {
  owner: string;
  name: string;
  externalRepositoryId: string;
};

export type RepositoryAccessRepository = {
  externalRepositoryId: string;
  owner: string;
  name: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
};

export interface ListSelectedRepositoryAccessParams {
  connection: {id: string; workspaceId: string};
  projects: ProjectsModuleClient;
  limit: number;
  cursor?: RepositoryAccessCursor | undefined;
}

export interface ListSelectedRepositoryAccessResult {
  repositories: RepositoryAccessRepository[];
  nextCursor: RepositoryAccessCursor | null;
}

export async function listSelectedRepositoryAccess(
  params: ListSelectedRepositoryAccessParams,
): Promise<ListSelectedRepositoryAccessResult> {
  const result = await params.projects.listProjectsBySourceConnection({
    workspaceId: params.connection.workspaceId,
    sourceConnectionId: params.connection.id,
    limit: params.limit,
    ...(params.cursor ? {cursor: params.cursor} : {}),
  });

  return {
    repositories: result.projects.map((project) => ({
      externalRepositoryId: project.externalRepositoryId,
      owner: project.owner,
      name: project.name,
      projectId: project.projectId,
      projectName: project.projectName,
      projectSlug: project.projectSlug,
    })),
    nextCursor: result.nextCursor,
  };
}
