import type {RepositoryVisibility} from '#core/entities/repository.js';
import type {VcsProviderKind} from '#core/entities/vcs-connection.js';
import {db} from './db.js';
import {repositories, toRepository} from './schema/repositories.js';

export interface RepositorySnapshot {
  provider: VcsProviderKind;
  providerHost: string;
  externalRepositoryId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  visibility: RepositoryVisibility;
  cloneUrl: string;
  htmlUrl: string;
}

export interface UpsertRepositoryParams extends RepositorySnapshot {
  vcsConnectionId: string;
}

export async function upsertRepository(params: UpsertRepositoryParams) {
  const now = new Date();
  const [row] = await db()
    .insert(repositories)
    .values({
      vcsConnectionId: params.vcsConnectionId,
      provider: params.provider,
      providerHost: params.providerHost,
      externalRepositoryId: params.externalRepositoryId,
      owner: params.owner,
      name: params.name,
      fullName: params.fullName,
      defaultBranch: params.defaultBranch,
      visibility: params.visibility,
      cloneUrl: params.cloneUrl,
      htmlUrl: params.htmlUrl,
      metadataFetchedAt: now,
    })
    .onConflictDoUpdate({
      target: [repositories.vcsConnectionId, repositories.externalRepositoryId],
      set: {
        owner: params.owner,
        name: params.name,
        fullName: params.fullName,
        defaultBranch: params.defaultBranch,
        visibility: params.visibility,
        cloneUrl: params.cloneUrl,
        htmlUrl: params.htmlUrl,
        metadataFetchedAt: now,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) throw new Error('Upsert returned no rows');
  return toRepository(row);
}
