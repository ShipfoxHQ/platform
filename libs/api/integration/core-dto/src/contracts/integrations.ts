export type IntegrationProviderKind = string;
export type IntegrationCapability = 'source_control';
export type IntegrationConnectionLifecycleStatus = 'active' | 'disabled' | 'error';

export interface IntegrationConnection<
  ProviderKind extends IntegrationProviderKind = IntegrationProviderKind,
> {
  id: string;
  workspaceId: string;
  provider: ProviderKind;
  externalAccountId: string;
  displayName: string;
  lifecycleStatus: IntegrationConnectionLifecycleStatus;
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

export interface ListRepositoriesInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  connection: Connection;
  limit: number;
  cursor?: string | undefined;
}

export interface ResolveRepositoryInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  connection: Connection;
  externalRepositoryId: string;
}

export interface FileSnapshot {
  path: string;
  ref: string;
  content: string;
}

export interface FetchFileInput<Connection extends IntegrationConnection = IntegrationConnection>
  extends ResolveRepositoryInput<Connection> {
  ref: string;
  path: string;
}

export interface CheckoutSpec {
  repositoryUrl: string;
  ref: string;
}

export interface CreateCheckoutSpecInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> extends ResolveRepositoryInput<Connection> {
  ref: string;
}

export interface SourceControlProvider<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  listRepositories(input: ListRepositoriesInput<Connection>): Promise<RepositoryPage>;
  resolveRepository(input: ResolveRepositoryInput<Connection>): Promise<RepositorySnapshot>;
  fetchFile?(input: FetchFileInput<Connection>): Promise<FileSnapshot>;
  createCheckoutSpec?(input: CreateCheckoutSpecInput<Connection>): Promise<CheckoutSpec>;
}

export interface IntegrationProviderAdapters<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  source_control?: SourceControlProvider<Connection> | undefined;
}

export interface IntegrationProvider<
  ProviderKind extends IntegrationProviderKind = IntegrationProviderKind,
  Route = unknown,
  Connection extends IntegrationConnection<ProviderKind> = IntegrationConnection<ProviderKind>,
> {
  provider: ProviderKind;
  displayName: string;
  adapters?: IntegrationProviderAdapters<Connection> | undefined;
  routes?: Route[] | undefined;
}

export interface RegisteredIntegrationProvider<
  ProviderKind extends IntegrationProviderKind = IntegrationProviderKind,
  Route = unknown,
  Connection extends IntegrationConnection<ProviderKind> = IntegrationConnection<ProviderKind>,
> extends IntegrationProvider<ProviderKind, Route, Connection> {
  adapters: IntegrationProviderAdapters<Connection>;
  capabilities: IntegrationCapability[];
}
