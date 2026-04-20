import {Factory} from 'fishery';
import type {Repository} from '#core/entities/index.js';
import {upsertRepository} from '#db/index.js';

export const repositoryFactory = Factory.define<Repository>(({sequence, onCreate}) => {
  onCreate((repository) =>
    upsertRepository({
      vcsConnectionId: repository.vcsConnectionId,
      provider: repository.provider,
      providerHost: repository.providerHost,
      externalRepositoryId: repository.externalRepositoryId,
      owner: repository.owner,
      name: repository.name,
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
      visibility: repository.visibility,
      cloneUrl: repository.cloneUrl,
      htmlUrl: repository.htmlUrl,
    }),
  );

  const name = `repo-${sequence}`;

  return {
    id: crypto.randomUUID(),
    vcsConnectionId: crypto.randomUUID(),
    provider: 'test',
    providerHost: 'test.local',
    externalRepositoryId: `repo-${sequence}`,
    owner: 'test-owner',
    name,
    fullName: `test-owner/${name}`,
    defaultBranch: 'main',
    visibility: 'private',
    cloneUrl: `https://test.local/test-owner/${name}.git`,
    htmlUrl: `https://test.local/test-owner/${name}`,
    metadataFetchedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
