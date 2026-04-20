import type {VcsProviderKind} from './vcs-connection.js';

export type RepositoryVisibility = 'public' | 'private' | 'internal' | 'unknown';

export interface Repository {
  id: string;
  vcsConnectionId: string;
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
  metadataFetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
