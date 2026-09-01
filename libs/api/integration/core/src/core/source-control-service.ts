import {normalizeCheckoutTarget} from '@shipfox/api-integration-spi';
import type {IntegrationConnection} from './entities/connection.js';
import {
  IntegrationCheckoutUnsupportedError,
  IntegrationConnectionInactiveError,
  IntegrationConnectionNotFoundError,
  IntegrationConnectionWorkspaceMismatchError,
  IntegrationProviderError,
  IntegrationRepositoryAuthorizationError,
} from './errors.js';
import type {IntegrationProviderRegistry} from './providers/registry.js';
import type {
  CheckoutCredentials,
  CheckoutPermissions,
  CheckoutSpec,
  CheckoutTarget,
  CheckoutTargetInput,
  FilePage,
  FileSnapshot,
  RepositoryPage,
  RepositorySnapshot,
  ResolvedRef,
  TriggerReference,
} from './providers/source-control.js';
import type {
  RepositoryAuthorizationMode,
  RepositoryAuthorizationResult,
  RepositoryAuthorizer,
} from './repository-authorizer.js';
import {RepositoryAuthorizationTargetInvalidError} from './repository-authorizer.js';

export type AuthorizedCheckoutSpec = CheckoutSpec & {target: CheckoutTarget};

export interface IntegrationSourceControlService {
  getConnection(connectionId: string): Promise<IntegrationConnection>;
  listRepositories(input: ListSourceRepositoriesInput): Promise<RepositoryPage>;
  resolveRepository(input: ResolveSourceRepositoryInput): Promise<ResolvedSourceRepository>;
  resolveTriggerReference(input: ResolveTriggerReferenceInput): Promise<TriggerReference | null>;
  resolveSourceRef(input: ResolveSourceRefInput): Promise<ResolvedRef>;
  listFiles(input: ListSourceFilesInput): Promise<FilePage>;
  fetchFile(input: FetchSourceFileInput): Promise<FileSnapshot>;
  createCheckoutSpec(input: CreateSourceCheckoutSpecInput): Promise<AuthorizedCheckoutSpec>;
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

export type CreateSourceCheckoutSpecInput = {
  workspaceId: string;
  connectionId: string;
  projectId?: string | undefined;
  ref?: string | undefined;
  permissions?: CheckoutPermissions | undefined;
} & CheckoutTargetInput;

export type CreateSourceCheckoutCredentialsInput = {
  workspaceId: string;
  connectionId: string;
  projectId?: string | undefined;
  permissions: CheckoutPermissions;
  rejectedGeneration?: string | undefined;
} & CheckoutTargetInput;

export interface ResolvedSourceRepository {
  connection: IntegrationConnection;
  repository: RepositorySnapshot;
}

export interface CreateIntegrationSourceControlServiceOptions {
  registry: IntegrationProviderRegistry;
  getIntegrationConnectionById: (
    connectionId: string,
  ) => Promise<IntegrationConnection | undefined>;
  repositoryAuthorizer?: RepositoryAuthorizer | undefined;
  /** Trusted server-side seam for overriding the persisted per-connection repository mode. */
  getRepositoryAuthorizationMode?:
    | ((
        connection: IntegrationConnection,
      ) => RepositoryAuthorizationMode | Promise<RepositoryAuthorizationMode>)
    | undefined;
}

export function createSourceControlIntegrationService({
  registry,
  getIntegrationConnectionById,
  repositoryAuthorizer,
  getRepositoryAuthorizationMode = (connection) => connection.repositoryAccessMode,
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

    async createCheckoutSpec(input) {
      const {workspaceId, connectionId, projectId, ref, permissions} = input;
      const connection = await getConnection(connectionId);
      if (connection.workspaceId !== workspaceId) {
        throw new IntegrationConnectionWorkspaceMismatchError(connectionId);
      }
      const sourceControl = registry.getAdapter(connection.provider, 'source_control');
      if (!sourceControl.createCheckoutSpec) {
        throw new IntegrationCheckoutUnsupportedError(connection.provider);
      }
      const target = await authorizeCheckoutTarget({
        connection,
        input,
        repositoryAuthorizer,
        getRepositoryAuthorizationMode,
      });

      const spec = await sourceControl.createCheckoutSpec({
        connection,
        target,
        ...(projectId === undefined ? {} : {projectId}),
        ref,
        permissions,
      });
      return {
        ...spec,
        target: checkoutSpecTarget(target, spec.target),
      };
    },

    async createCheckoutCredentials(input) {
      const {workspaceId, connectionId, projectId, permissions, rejectedGeneration} = input;
      const connection = await getConnection(connectionId);
      if (connection.workspaceId !== workspaceId) {
        throw new IntegrationConnectionWorkspaceMismatchError(connectionId);
      }
      const sourceControl = registry.get(connection.provider).adapters.source_control;
      if (!sourceControl?.createCheckoutCredentials) {
        throw new IntegrationCheckoutUnsupportedError(connection.provider);
      }
      const target = await authorizeCheckoutTarget({
        connection,
        input,
        repositoryAuthorizer,
        getRepositoryAuthorizationMode,
      });

      const credentials = await sourceControl.createCheckoutCredentials({
        connection,
        target,
        ...(projectId === undefined ? {} : {projectId}),
        permissions,
        rejectedGeneration,
      });
      if (
        rejectedGeneration !== undefined &&
        (credentials.generation === undefined || credentials.generation === rejectedGeneration)
      ) {
        throw new IntegrationProviderError(
          'provider-rejected',
          'Provider returned a rejected or unidentified checkout credential generation',
        );
      }
      return credentials;
    },
  };
}

async function authorizeCheckoutTarget(params: {
  connection: IntegrationConnection;
  input: CheckoutTargetInput & {workspaceId: string};
  repositoryAuthorizer: RepositoryAuthorizer | undefined;
  getRepositoryAuthorizationMode: (
    connection: IntegrationConnection,
  ) => RepositoryAuthorizationMode | Promise<RepositoryAuthorizationMode>;
}): Promise<CheckoutTarget> {
  const target = checkoutTarget(params.input);
  if (params.repositoryAuthorizer === undefined) return target;

  const authorization = await params.repositoryAuthorizer.resolveRepositoryAuthorization({
    workspaceId: params.input.workspaceId,
    connectionId: params.connection.id,
    mode: await params.getRepositoryAuthorizationMode(params.connection),
    repository: target,
    capability: 'checkout',
  });
  if (authorization === undefined) return target;
  if (!authorization.authorized) {
    throw new IntegrationRepositoryAuthorizationError(authorization.reason);
  }
  return checkoutTargetFromAuthorization(authorization);
}

function checkoutTargetFromAuthorization(
  authorization: Extract<RepositoryAuthorizationResult, {authorized: true}>,
): CheckoutTarget {
  if (authorization.repository.externalRepositoryId !== undefined) {
    return {
      kind: 'external-id',
      externalRepositoryId: authorization.repository.externalRepositoryId,
    };
  }
  if (authorization.repository.owner !== undefined && authorization.repository.name !== undefined) {
    return {
      kind: 'name',
      owner: authorization.repository.owner,
      name: authorization.repository.name,
    };
  }
  throw new RepositoryAuthorizationTargetInvalidError();
}

function checkoutSpecTarget(
  target: CheckoutTarget,
  providerTarget: CheckoutSpec['target'],
): CheckoutTarget {
  // Name targets are the only form whose provider response can add a stable
  // identity for credential renewal. An authorizer's external-id decision is
  // already canonical and must remain authoritative for every other input.
  return target.kind === 'name' && providerTarget?.kind === 'external-id' ? providerTarget : target;
}

function checkoutTarget(input: CheckoutTargetInput): CheckoutTarget {
  const result = normalizeCheckoutTarget(input);
  if (result.status === 'valid') return result.target;
  if (result.status === 'ambiguous') {
    throw new IntegrationProviderError(
      'provider-rejected',
      'Checkout input cannot include both a target and an external repository id',
    );
  }
  throw new IntegrationProviderError(
    'repository-not-found',
    'Checkout input must include exactly one target or external repository id',
  );
}
