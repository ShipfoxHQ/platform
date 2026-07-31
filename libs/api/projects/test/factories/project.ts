import {withSlugSuffix} from '@shipfox/api-common-dto';
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
      slug: project.slug,
    }),
  );

  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    sourceConnectionId: crypto.randomUUID(),
    sourceExternalRepositoryId: `repository-${sequence}`,
    sourceRepositoryOwner: null,
    sourceRepositoryName: null,
    sourceDefaultBranch: null,
    name: `Project ${sequence}`,
    slug: withSlugSuffix('project', sequence + 1),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
