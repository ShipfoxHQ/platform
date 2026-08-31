import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
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
  resolveCheckoutTarget,
  updateProjectSourceMetadata,
} from '#db/projects.js';

export function createProjectsInterModulePresentation(params: {
  integrations: Pick<IntegrationsModuleClient, 'resolveSourceRepository'>;
}): InterModulePresentation<typeof projectsInterModuleContract> {
  return defineInterModulePresentation(projectsInterModuleContract, {
    getProjectById: async ({projectId}) => ({project: (await getProjectById(projectId)) ?? null}),
    getProjectBySource: async (input) => ({
      project: (await getProjectBySource(input)) ?? null,
    }),
    findProjectBySourceRepositoryName: async (input) => ({
      projects: await findProjectBySourceRepositoryName(input),
    }),
    listProjectsByWorkspace: async ({workspaceId, limit, cursor}) => {
      const result = await listProjects({
        workspaceId,
        limit,
        ...(cursor ? {cursor: {createdAt: new Date(cursor.createdAt), id: cursor.id}} : {}),
      });
      return {
        projects: result.projects.map(toProjectCatalogInterModule),
        nextCursor: result.nextCursor
          ? {createdAt: result.nextCursor.createdAt.toISOString(), id: result.nextCursor.id}
          : null,
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

      if ('repository' in input.target) {
        const source = await params.integrations
          .resolveSourceRepository({
            workspaceId: input.workspaceId,
            connectionId: target.connectionId,
            externalRepositoryId: target.externalRepositoryId,
          })
          .catch(() => undefined);
        if (source === undefined) {
          throw createInterModuleKnownError(
            projectsInterModuleContract.methods.resolveCheckoutTarget,
            'checkout-repository-not-authorized',
            {},
          );
        }

        const {owner: requestedOwner, name: requestedName} = requestedRepository(
          input.target.repository,
          input.defaults.owner,
        );
        const repositoryMatches =
          source.repository.owner.toLowerCase() === requestedOwner.toLowerCase() &&
          source.repository.name.toLowerCase() === requestedName.toLowerCase();

        await updateProjectSourceMetadata({
          workspaceId: input.workspaceId,
          projectId: target.projectId,
          sourceConnectionId: source.connection.id,
          sourceExternalRepositoryId: source.repository.externalRepositoryId,
          sourceRepositoryOwner: source.repository.owner,
          sourceRepositoryName: source.repository.name,
          sourceDefaultBranch: source.repository.defaultBranch,
        });

        if (!repositoryMatches) {
          throw createInterModuleKnownError(
            projectsInterModuleContract.methods.resolveCheckoutTarget,
            'checkout-repository-not-authorized',
            {},
          );
        }

        return {
          ...target,
          connectionId: source.connection.id,
          externalRepositoryId: source.repository.externalRepositoryId,
        };
      }

      return target;
    },
  });
}

function toProjectCatalogInterModule(project: Project) {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    sourceConnectionId: project.sourceConnectionId,
    sourceExternalRepositoryId: project.sourceExternalRepositoryId,
    sourceRepositoryOwner: project.sourceRepositoryOwner,
    sourceRepositoryName: project.sourceRepositoryName,
    sourceDefaultBranch: project.sourceDefaultBranch,
    name: project.name,
    slug: project.slug,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function requestedRepository(
  repository: string,
  defaultOwner: string,
): {owner: string; name: string} {
  const separator = repository.indexOf('/');
  if (separator === -1) return {owner: defaultOwner, name: repository};
  return {owner: repository.slice(0, separator), name: repository.slice(separator + 1)};
}
