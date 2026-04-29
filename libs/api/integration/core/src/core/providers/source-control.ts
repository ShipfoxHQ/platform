import type {IntegrationConnection} from '#core/entities/connection.js';

export type RepositoryVisibility = 'public' | 'private' | 'internal' | 'unknown';

export interface RepositorySnapshot {
  externalRepositoryId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  visibility: RepositoryVisibility;
  cloneUrl: string;
  htmlUrl: string;
}

export interface RepositoryPage {
  repositories: RepositorySnapshot[];
  nextCursor: string | null;
}

export interface ListRepositoriesInput {
  connection: IntegrationConnection;
  limit: number;
  cursor?: string | undefined;
}

export interface ResolveRepositoryInput {
  connection: IntegrationConnection;
  externalRepositoryId: string;
}

export interface FileSnapshot {
  path: string;
  ref: string;
  content: string;
}

export interface FetchFileInput extends ResolveRepositoryInput {
  ref: string;
  path: string;
}

export interface CheckoutSpec {
  repositoryUrl: string;
  ref: string;
}

export interface CreateCheckoutSpecInput extends ResolveRepositoryInput {
  ref: string;
}

export interface SourceControlProvider {
  listRepositories(input: ListRepositoriesInput): Promise<RepositoryPage>;
  resolveRepository(input: ResolveRepositoryInput): Promise<RepositorySnapshot>;
  fetchFile?(input: FetchFileInput): Promise<FileSnapshot>;
  createCheckoutSpec?(input: CreateCheckoutSpecInput): Promise<CheckoutSpec>;
}
