import type {RouteExport} from '@shipfox/node-fastify';

export type IntegrationCapability = 'source_control';
export type IntegrationProviderKind = 'github';
export type IntegrationConnectionLifecycleStatus = 'active' | 'disabled' | 'error';

export interface IntegrationConnection {
  id: string;
  workspaceId: string;
  provider: IntegrationProviderKind;
  externalAccountId: string;
  displayName: string;
  lifecycleStatus: IntegrationConnectionLifecycleStatus;
  capabilities: IntegrationCapability[];
  createdAt: Date;
  updatedAt: Date;
}

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

export interface SourceControlProvider {
  listRepositories(input: ListRepositoriesInput): Promise<RepositoryPage>;
  resolveRepository(input: ResolveRepositoryInput): Promise<RepositorySnapshot>;
}

export interface IntegrationProvider {
  provider: IntegrationProviderKind;
  displayName: string;
  capabilities: IntegrationCapability[];
  sourceControl?: SourceControlProvider | undefined;
  routes?: RouteExport[] | undefined;
}
