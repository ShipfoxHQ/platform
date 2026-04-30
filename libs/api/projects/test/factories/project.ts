import {Factory} from 'fishery';
import type {Project} from '#core/entities/index.js';
import {createProject} from '#db/index.js';

export const projectFactory = Factory.define<Project>(({sequence, onCreate}) => {
  onCreate(async (project) =>
    createProject({
      workspaceId: project.workspaceId,
      sourceConnectionId: project.sourceConnectionId,
      sourceExternalRepositoryId: project.sourceExternalRepositoryId,
      name: project.name,
    }),
  );

  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    sourceConnectionId: crypto.randomUUID(),
    sourceExternalRepositoryId: `repository-${sequence}`,
    name: `Project ${sequence}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
