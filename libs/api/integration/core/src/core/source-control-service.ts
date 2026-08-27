import type {IntegrationConnection} from './entities/connection.js';
import {
  IntegrationCheckoutUnsupportedError,
  IntegrationConnectionInactiveError,
  IntegrationConnectionNotFoundError,
  IntegrationConnectionWorkspaceMismatchError,
  IntegrationProviderError,
} from './errors.js';
import type {IntegrationProviderRegistry} from './providers/registry.js';
import type {
  CheckoutCredentials,
  CheckoutPermissions,
  CheckoutSpec,
  FilePage,
  FileSnapshot,
  RepositoryPage,
  RepositorySnapshot,
  ResolvedRef,
  TriggerReference,
} from './providers/source-control.js';

export interface IntegrationSourceControlService {
  getConnection(connectionId: string): Promise<IntegrationConnection>;
  listRepositories(input: ListSourceRepositoriesInput): Promise<RepositoryPage>;
  resolveRepository(input: ResolveSourceRepositoryInput): Promise<ResolvedSourceRepository>;
  resolveTriggerReference(input: ResolveTriggerReferenceInput): Promise<TriggerReference | null>;
  resolveSourceRef(input: ResolveSourceRefInput): Promise<ResolvedRef>;
  listFiles(input: ListSourceFilesInput): Promise<FilePage>;
  fetchFile(input: FetchSourceFileInput): Promise<FileSnapshot>;
  createCheckoutSpec(input: CreateSourceCheckoutSpecInput): Promise<CheckoutSpec>;
  createCheckoutCredentials(
    input: CreateSourceCheckoutCredentialsInput,
  ): Promise<CheckoutCredentials>;
}

export interface ListSourceRepositoriesInput {
  connection: IntegrationConnection;
  limit: number;
  cursor?: string | undefined;
  search?: string | undefined;
}

export interface ResolveSourceRepositoryInput {
  workspaceId: string;
  connectionId: string;
  externalRepositoryId: string;
}

export interface ResolveTriggerReferenceInput {
  workspaceId: string;
  connectionId: string;
  payload: unknown;
}

export interface ResolveSourceRefInput extends ResolveSourceRepositoryInput {
  ref: string;
}

export interface ListSourceFilesInput extends ResolveSourceRepositoryInput {
  ref: string;
  prefix: string;
  limit: number;
  cursor?: string | undefined;
}

export interface FetchSourceFileInput extends ResolveSourceRepositoryInput {
  ref: string;
  path: string;
}

export interface CreateSourceCheckoutSpecInput extends ResolveSourceRepositoryInput {
  ref?: string | undefined;
  permissions?: CheckoutPermissions | undefined;
}

export interface CreateSourceCheckoutCredentialsInput extends ResolveSourceRepositoryInput {
  permissions: CheckoutPermissions;
  rejectedGeneration?: string | undefined;
}

export interface ResolvedSourceRepository {
  connection: IntegrationConnection;
  repository: RepositorySnapshot;
}

export interface CreateIntegrationSourceControlServiceOptions {
  registry: IntegrationProviderRegistry;
  getIntegrationConnectionById: (
    connectionId: string,
  ) => Promise<IntegrationConnection | undefined>;
}

export function createSourceControlIntegrationService({
  registry,
  getIntegrationConnectionById,
}: CreateIntegrationSourceControlServiceOptions): IntegrationSourceControlService {
  async function getConnection(connectionId: string): Promise<IntegrationConnection> {
    const connection = await getIntegrationConnectionById(connectionId);
    if (!connection) throw new IntegrationConnectionNotFoundError(connectionId);
    if (connection.lifecycleStatus !== 'active') {
      throw new IntegrationConnectionInactiveError(connection.id);
    }

    return connection;
  }

  return {
    getConnection,

    async listRepositories({connection, limit, cursor, search}) {
      const sourceControl = registry.getAdapter(connection.provider, 'source_control');
      return await sourceControl.listRepositories({
        connection,
        limit,
        cursor,
        search,
      });
    },

    async resolveRepository({workspaceId, connectionId, externalRepositoryId}) {
      const connection = await getConnection(connectionId);
      if (connection.workspaceId !== workspaceId) {
        throw new IntegrationConnectionWorkspaceMismatchError(connectionId);
      }
      const sourceControl = registry.getAdapter(connection.provider, 'source_control');

      const repository = await sourceControl.resolveRepository({
        connection,
        externalRepositoryId,
      });

      return {connection, repository};
    },

    async resolveTriggerReference({workspaceId, connectionId, payload}) {
      const connection = await getConnection(connectionId);
      if (connection.workspaceId !== workspaceId) {
        throw new IntegrationConnectionWorkspaceMismatchError(connectionId);
      }

      // Not every integration source names a repository (for example Linear),
      // so a missing source-control adapter is a valid null reference rather
      // than a failed run creation.
      const sourceControl = registry.get(connection.provider).adapters.source_control;
      return sourceControl?.resolveTriggerReference(payload) ?? null;
    },

    async resolveSourceRef({workspaceId, connectionId, externalRepositoryId, ref}) {
      const connection = await getConnection(connectionId);
      if (connection.workspaceId !== workspaceId) {
        throw new IntegrationConnectionWorkspaceMismatchError(connectionId);
      }
      const sourceControl = registry.getAdapter(connection.provider, 'source_control');

      return await sourceControl.resolveRef({connection, externalRepositoryId, ref});
    },

    async listFiles({workspaceId, connectionId, externalRepositoryId, ref, prefix, limit, cursor}) {
      const connection = await getConnection(connectionId);
      if (connection.workspaceId !== workspaceId) {
        throw new IntegrationConnectionWorkspaceMismatchError(connectionId);
      }
      const sourceControl = registry.getAdapter(connection.provider, 'source_control');

      return await sourceControl.listFiles({
        connection,
        externalRepositoryId,
        ref,
        prefix,
        limit,
        cursor,
      });
    },

    async fetchFile({workspaceId, connectionId, externalRepositoryId, ref, path}) {
      const connection = await getConnection(connectionId);
      if (connection.workspaceId !== workspaceId) {
        throw new IntegrationConnectionWorkspaceMismatchError(connectionId);
      }
      const sourceControl = registry.getAdapter(connection.provider, 'source_control');

      return await sourceControl.fetchFile({
        connection,
        externalRepositoryId,
        ref,
        path,
      });
    },

    async createCheckoutSpec({workspaceId, connectionId, externalRepositoryId, ref, permissions}) {
      const connection = await getConnection(connectionId);
      if (connection.workspaceId !== workspaceId) {
        throw new IntegrationConnectionWorkspaceMismatchError(connectionId);
      }
      const sourceControl = registry.getAdapter(connection.provider, 'source_control');
      if (!sourceControl.createCheckoutSpec) {
        throw new IntegrationCheckoutUnsupportedError(connection.provider);
      }

      return await sourceControl.createCheckoutSpec({
        connection,
        externalRepositoryId,
        ref,
        permissions,
      });
    },

    async createCheckoutCredentials({
      workspaceId,
      connectionId,
      externalRepositoryId,
      permissions,
      rejectedGeneration,
    }) {
      const connection = await getConnection(connectionId);
      if (connection.workspaceId !== workspaceId) {
        throw new IntegrationConnectionWorkspaceMismatchError(connectionId);
      }
      const sourceControl = registry.get(connection.provider).adapters.source_control;
      if (!sourceControl?.createCheckoutCredentials) {
        throw new IntegrationCheckoutUnsupportedError(connection.provider);
      }

      const credentials = await sourceControl.createCheckoutCredentials({
        connection,
        externalRepositoryId,
        permissions,
        rejectedGeneration,
      });
      if (credentials.generation !== undefined && credentials.generation === rejectedGeneration) {
        throw new IntegrationProviderError(
          'provider-rejected',
          'Provider returned a rejected checkout credential generation',
        );
      }
      return credentials;
    },
  };
}
