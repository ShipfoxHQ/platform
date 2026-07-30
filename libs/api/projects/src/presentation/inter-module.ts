import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {
  getProjectById,
  getWorkspaceProjectCounts,
  resolveCheckoutTarget,
  updateProjectSourceMetadata,
} from '#db/projects.js';

export function createProjectsInterModulePresentation(params: {
  integrations: Pick<IntegrationsModuleClient, 'resolveSourceRepository'>;
}): InterModulePresentation<typeof projectsInterModuleContract> {
  return defineInterModulePresentation(projectsInterModuleContract, {
    getProjectById: async ({projectId}) => ({project: (await getProjectById(projectId)) ?? null}),
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

        const separator = input.target.repository.indexOf('/');
        const requestedOwner =
          separator === -1 ? input.defaults.owner : input.target.repository.slice(0, separator);
        const requestedName =
          separator === -1 ? input.target.repository : input.target.repository.slice(separator + 1);
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
