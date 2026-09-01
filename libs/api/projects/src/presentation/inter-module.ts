import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import type {Project} from '#core/entities/project.js';
import {
  findProjectBySourceRepositoryName,
  getProjectById,
  getProjectBySource,
  getWorkspaceProjectCounts,
  listProjects,
  listProjectsBySourceConnection,
  type ProjectRepositoryListCursor,
  type ProjectRepositoryListItem,
  resolveCheckoutTarget,
} from '#db/projects.js';

export function createProjectsInterModulePresentation(): InterModulePresentation<
  typeof projectsInterModuleContract
> {
  return defineInterModulePresentation(projectsInterModuleContract, {
    getProjectById: async ({projectId}) => ({project: (await getProjectById(projectId)) ?? null}),
    getProjectBySource: async (input) => ({
      project: (await getProjectBySource(input)) ?? null,
    }),
    findProjectBySourceRepositoryName: async (input) => ({
      projects: await findProjectBySourceRepositoryName(input),
    }),
    listProjectsBySourceConnection: async (input) => {
      const result = await listProjectsBySourceConnection({
        workspaceId: input.workspaceId,
        sourceConnectionId: input.sourceConnectionId,
        limit: input.limit,
        ...(input.cursor
          ? {
              cursor: {
                sourceRepositoryOwner: input.cursor.owner,
                sourceRepositoryName: input.cursor.name,
                sourceExternalRepositoryId: input.cursor.externalRepositoryId,
              },
            }
          : {}),
      });

      return {
        projects: result.projects.map(toProjectRepositoryInterModule),
        nextCursor: toProjectRepositoryCursor(result.nextCursor),
      };
    },
    listProjectsByWorkspace: async ({workspaceId, limit, cursor}) => {
      const result = await listProjectPage({workspaceId, limit, cursor});
      return {
        projects: result.projects.map(toProjectInterModule),
        nextCursor: toProjectCursor(result.nextCursor),
      };
    },
    listProjectCatalogByWorkspace: async ({workspaceId, limit, cursor}) => {
      const result = await listProjectPage({workspaceId, limit, cursor});
      return {
        projects: result.projects.map(toProjectCatalogInterModule),
        nextCursor: toProjectCursor(result.nextCursor),
      };
    },
    requireProjectForWorkspace: async ({projectId, workspaceId}) => {
      const project = await getProjectById(projectId);
      if (project === undefined) {
        throw createInterModuleKnownError(
          projectsInterModuleContract.methods.requireProjectForWorkspace,
          'project-not-found',
          {projectId},
        );
      }
      if (project.workspaceId !== workspaceId) {
        throw createInterModuleKnownError(
          projectsInterModuleContract.methods.requireProjectForWorkspace,
          'project-workspace-mismatch',
          {projectId, workspaceId},
        );
      }
      return {project};
    },
    getWorkspaceProjectCounts: async ({workspaceIds}) => ({
      counts: await getWorkspaceProjectCounts({workspaceIds}),
    }),
    resolveCheckoutTarget: async (input) => {
      const target = await resolveCheckoutTarget(input);
      if (target === undefined) {
        throw createInterModuleKnownError(
          projectsInterModuleContract.methods.resolveCheckoutTarget,
          'checkout-repository-not-authorized',
          {},
        );
      }

      return target;
    },
  });
}

async function listProjectPage(input: {
  workspaceId: string;
  limit: number;
  cursor?: {createdAt: string; id: string} | undefined;
}) {
  return await listProjects({
    workspaceId: input.workspaceId,
    limit: input.limit,
    ...(input.cursor
      ? {cursor: {createdAt: new Date(input.cursor.createdAt), id: input.cursor.id}}
      : {}),
  });
}

function toProjectCursor(cursor: {createdAt: Date; id: string} | null) {
  return cursor ? {createdAt: cursor.createdAt.toISOString(), id: cursor.id} : null;
}

function toProjectRepositoryInterModule(repository: ProjectRepositoryListItem) {
  return {
    externalRepositoryId: repository.sourceExternalRepositoryId,
    owner: repository.sourceRepositoryOwner,
    name: repository.sourceRepositoryName,
    projectId: repository.projectId,
    projectName: repository.projectName,
  };
}

function toProjectRepositoryCursor(cursor: ProjectRepositoryListCursor | null) {
  return cursor
    ? {
        owner: cursor.sourceRepositoryOwner,
        name: cursor.sourceRepositoryName,
        externalRepositoryId: cursor.sourceExternalRepositoryId,
      }
    : null;
}

function toProjectCatalogInterModule(project: Project) {
  return {
    ...toProjectInterModule(project),
    slug: project.slug,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function toProjectInterModule(project: Project) {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    sourceConnectionId: project.sourceConnectionId,
    sourceExternalRepositoryId: project.sourceExternalRepositoryId,
    sourceRepositoryOwner: project.sourceRepositoryOwner,
    sourceRepositoryName: project.sourceRepositoryName,
    sourceDefaultBranch: project.sourceDefaultBranch,
    name: project.name,
  };
}
