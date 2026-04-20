import {Factory} from 'fishery';
import type {ProjectWithRepository} from '#core/entities/index.js';
import {createProject} from '#db/index.js';
import {repositoryFactory} from './repository.js';
import {vcsConnectionFactory} from './vcs-connection.js';

export const projectFactory = Factory.define<ProjectWithRepository>(({sequence, onCreate}) => {
  onCreate(async (project) => {
    const connection = await vcsConnectionFactory.create({workspaceId: project.workspaceId});
    const repository = await repositoryFactory.create({
      vcsConnectionId: connection.id,
      provider: connection.provider,
      providerHost: connection.providerHost,
    });

    return createProject({
      workspaceId: project.workspaceId,
      repositoryId: repository.id,
      name: project.name,
    });
  });

  const repository = repositoryFactory.build();

  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    repositoryId: repository.id,
    name: `Project ${sequence}`,
    repository,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
