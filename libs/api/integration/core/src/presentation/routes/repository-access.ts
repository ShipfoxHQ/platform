import {
  AUTH_USER,
  rejectImpersonatedSession,
  requireWorkspaceAccess,
} from '@shipfox/api-auth-context';
import {
  createIntegrationConnectionRepositoryGrantBodySchema,
  integrationConnectionRepositoryAccessResponseSchema,
  integrationConnectionRepositoryGrantDtoSchema,
  listIntegrationConnectionRepositoryAccessQuerySchema,
  parseProviderRepositoryId,
  updateIntegrationConnectionRepositoryAccessBodySchema,
  updateIntegrationConnectionRepositoryAccessResponseSchema,
} from '@shipfox/api-integration-spi';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError, defineRoute, type RouteExport} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import type {IntegrationConnection} from '#core/entities/connection.js';
import type {IntegrationConnectionRepositoryGrant} from '#core/entities/repository-grant.js';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import {getIntegrationConnectionById} from '#db/connections.js';
import {
  deleteIntegrationConnectionRepositoryGrantByIdWithAudit,
  updateIntegrationConnectionRepositoryAccessModeWithAudit,
  upsertIntegrationConnectionRepositoryGrantWithAudit,
} from '#db/repository-access.js';
import {listIntegrationConnectionRepositoryGrants} from '#db/repository-grants.js';
import {toRepositoryGrantDto} from '#presentation/dto/integrations.js';
import {integrationRouteErrorHandler} from './errors.js';

const connectionParamsSchema = z.object({
  connectionId: z.string().uuid(),
});

type RepositoryAccessCursor = {
  owner: string;
  name: string;
  externalRepositoryId: string;
};

type ProjectRepository = Awaited<
  ReturnType<ProjectsModuleClient['listProjectsBySourceConnection']>
>['projects'][number];

type RepositoryAccessOrigin =
  | {type: 'project'; project_id: string; project_name: string}
  | {type: 'manual'; grant_id: string};

type RepositoryAccessRow = {
  external_repository_id: string;
  owner: string;
  name: string;
  origins: RepositoryAccessOrigin[];
};

export interface CreateRepositoryAccessReadRouteParams {
  registry: IntegrationProviderRegistry;
  projects?: ProjectsModuleClient | undefined;
}

export function createRepositoryAccessReadRoute(
  params: CreateRepositoryAccessReadRouteParams,
): RouteExport {
  return defineRoute({
    method: 'GET',
    path: '/integration-connections/:connectionId/repository-access',
    auth: AUTH_USER,
    description: 'Read the composed repository access for an integration connection.',
    schema: {
      params: connectionParamsSchema,
      querystring: listIntegrationConnectionRepositoryAccessQuerySchema,
      response: {200: integrationConnectionRepositoryAccessResponseSchema},
    },
    errorHandler: integrationRouteErrorHandler,
    handler: async (request) => {
      const connection = await loadConnection(request.params.connectionId);
      requireRepositoryAccessAdmin(request, connection);
      const provider = params.registry.get(connection.provider);
      requireRepositoryAccessSupport(provider.repositoryAuthorization);

      const cursor = decodeRepositoryAccessCursor(request.query.cursor);
      if (request.query.cursor && !cursor) {
        throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
      }

      if (connection.repositoryAccessMode === 'all') {
        return {mode: connection.repositoryAccessMode, repositories: [], next_cursor: null};
      }

      if (!params.projects) {
        throw new Error('Projects module client is required for selected repository access');
      }

      const result = await listSelectedRepositoryAccess({
        connection,
        projects: params.projects,
        limit: request.query.limit,
        cursor,
      });
      return {
        mode: connection.repositoryAccessMode,
        repositories: result.repositories,
        next_cursor: result.nextCursor,
      };
    },
  });
}

export interface CreateRepositoryAccessMutationRoutesParams {
  registry: IntegrationProviderRegistry;
  invalidateRepositoryAuthorizationCache?: ((connectionId: string) => void) | undefined;
}

export function createRepositoryAccessMutationRoutes(
  params: CreateRepositoryAccessMutationRoutesParams,
): RouteExport[] {
  const updateModeRoute = defineRoute({
    method: 'PUT',
    path: '/integration-connections/:connectionId/repository-access',
    auth: AUTH_USER,
    description: 'Set the repository access mode for an integration connection.',
    schema: {
      params: connectionParamsSchema,
      body: updateIntegrationConnectionRepositoryAccessBodySchema,
      response: {200: updateIntegrationConnectionRepositoryAccessResponseSchema},
    },
    errorHandler: integrationRouteErrorHandler,
    handler: async (request) => {
      rejectImpersonatedSession(request);
      const connection = await loadConnection(request.params.connectionId);
      const access = requireRepositoryAccessAdmin(request, connection);
      const provider = params.registry.get(connection.provider);
      requireRepositoryAccessSupport(provider.repositoryAuthorization);

      const updated = await updateIntegrationConnectionRepositoryAccessModeWithAudit({
        id: connection.id,
        repositoryAccessMode: request.body.mode,
        actorId: access.userId,
        provider: connection.provider,
        correlationId: request.id,
      });
      if (!updated) throw connectionNotFound();

      invalidate(params.invalidateRepositoryAuthorizationCache, updated.id);
      return {mode: updated.repositoryAccessMode};
    },
  });

  const grantRoute = defineRoute({
    method: 'POST',
    path: '/integration-connections/:connectionId/repository-grants',
    auth: AUTH_USER,
    description: 'Grant a repository to an integration connection.',
    schema: {
      params: connectionParamsSchema,
      body: createIntegrationConnectionRepositoryGrantBodySchema,
      response: {200: integrationConnectionRepositoryGrantDtoSchema},
    },
    errorHandler: integrationRouteErrorHandler,
    handler: async (request) => {
      rejectImpersonatedSession(request);
      const connection = await loadConnection(request.params.connectionId);
      const access = requireRepositoryAccessAdmin(request, connection);
      const provider = params.registry.get(connection.provider);
      requireRepositoryAccessSupport(provider.repositoryAuthorization);
      validateExternalRepositoryId(
        request.body.external_repository_id,
        connection.provider,
        request.body.owner,
        request.body.name,
      );

      const grant = await upsertIntegrationConnectionRepositoryGrantWithAudit({
        connectionId: connection.id,
        externalRepositoryId: request.body.external_repository_id,
        repositoryOwner: request.body.owner,
        repositoryName: request.body.name,
        actorId: access.userId,
        provider: connection.provider,
        correlationId: request.id,
      });
      if (!grant) throw connectionNotFound();

      invalidate(params.invalidateRepositoryAuthorizationCache, grant.connectionId);
      return toRepositoryGrantDto(grant);
    },
  });

  const revokeRoute = defineRoute({
    method: 'DELETE',
    path: '/integration-connections/:connectionId/repository-grants/:grantId',
    auth: AUTH_USER,
    description: 'Revoke a manually granted repository from an integration connection.',
    schema: {
      params: connectionParamsSchema.extend({grantId: z.string().uuid()}),
      response: {204: z.void()},
    },
    errorHandler: integrationRouteErrorHandler,
    handler: async (request, reply) => {
      rejectImpersonatedSession(request);
      const connection = await loadConnection(request.params.connectionId);
      const access = requireRepositoryAccessAdmin(request, connection);
      const provider = params.registry.get(connection.provider);
      requireRepositoryAccessSupport(provider.repositoryAuthorization);

      const grant = await deleteIntegrationConnectionRepositoryGrantByIdWithAudit({
        connectionId: connection.id,
        grantId: request.params.grantId,
        actorId: access.userId,
        provider: connection.provider,
        correlationId: request.id,
      });
      if (!grant) {
        throw new ClientError('Repository grant not found', 'not-found', {status: 404});
      }

      invalidate(params.invalidateRepositoryAuthorizationCache, grant.connectionId);
      reply.status(204);
    },
  });

  return [updateModeRoute, grantRoute, revokeRoute];
}

async function loadConnection(connectionId: string): Promise<IntegrationConnection> {
  const connection = await getIntegrationConnectionById(connectionId);
  if (!connection) throw connectionNotFound();
  return connection;
}

function requireRepositoryAccessAdmin(request: FastifyRequest, connection: IntegrationConnection) {
  const access = requireWorkspaceAccess({request, workspaceId: connection.workspaceId});
  if (access.role !== 'admin') {
    throw new ClientError('Workspace admin role required', 'forbidden', {status: 403});
  }
  return access;
}

function requireRepositoryAccessSupport(repositoryAuthorization: string | undefined): void {
  if (repositoryAuthorization === 'enforced') return;
  throw new ClientError(
    'This integration provider does not support repository access settings',
    'integration-repository-access-unsupported',
    {status: 422},
  );
}

async function listSelectedRepositoryAccess(params: {
  connection: IntegrationConnection;
  projects: ProjectsModuleClient;
  limit: number;
  cursor: RepositoryAccessCursor | undefined;
}): Promise<{repositories: RepositoryAccessRow[]; nextCursor: string | null}> {
  const projectListInput = {
    workspaceId: params.connection.workspaceId,
    sourceConnectionId: params.connection.id,
    limit: params.limit,
    ...(params.cursor ? {cursor: params.cursor} : {}),
  };
  const [firstProjectPage, grants] = await Promise.all([
    params.projects.listProjectsBySourceConnection(projectListInput),
    listIntegrationConnectionRepositoryGrants({connectionId: params.connection.id}),
  ]);

  const eligibleGrants = grants.filter((grant) => isAfterCursor(grantCursor(grant), params.cursor));
  const projectRepositories: ProjectRepository[] = firstProjectPage.projects.filter((project) =>
    isAfterCursor(projectCursor(project), params.cursor),
  );
  let nextProjectCursor = firstProjectPage.nextCursor;
  let repositories = composeRepositoryAccess(projectRepositories, eligibleGrants);

  while (repositories.length < params.limit && nextProjectCursor) {
    const projectPage = await params.projects.listProjectsBySourceConnection({
      workspaceId: params.connection.workspaceId,
      sourceConnectionId: params.connection.id,
      limit: params.limit,
      cursor: nextProjectCursor,
    });
    projectRepositories.push(
      ...projectPage.projects.filter((project) =>
        isAfterCursor(projectCursor(project), params.cursor),
      ),
    );
    nextProjectCursor = projectPage.nextCursor;
    repositories = composeRepositoryAccess(projectRepositories, eligibleGrants);
  }

  const page = repositories.slice(0, params.limit);
  const hasMore = repositories.length > params.limit || nextProjectCursor !== null;
  return {
    repositories: page,
    nextCursor:
      hasMore && page.length > 0
        ? encodeRepositoryAccessCursor({
            owner: page[page.length - 1]?.owner ?? '',
            name: page[page.length - 1]?.name ?? '',
            externalRepositoryId: page[page.length - 1]?.external_repository_id ?? '',
          })
        : null,
  };
}

function composeRepositoryAccess(
  projects: readonly ProjectRepository[],
  grants: readonly IntegrationConnectionRepositoryGrant[],
): RepositoryAccessRow[] {
  const candidates = [
    ...projects.map<RepositoryAccessCandidate>((project) => ({
      externalRepositoryId: project.externalRepositoryId,
      owner: project.owner,
      name: project.name,
      origin: {
        type: 'project',
        project_id: project.projectId,
        project_name: project.projectName,
      },
    })),
    ...grants.map<RepositoryAccessCandidate>((grant) => ({
      externalRepositoryId: grant.externalRepositoryId,
      owner: grant.repositoryOwner,
      name: grant.repositoryName,
      origin: {type: 'manual', grant_id: grant.id},
    })),
  ].sort(compareCandidates);

  const rows = new Map<string, RepositoryAccessRow>();
  for (const candidate of candidates) {
    const existing = rows.get(candidate.externalRepositoryId);
    if (!existing) {
      rows.set(candidate.externalRepositoryId, {
        external_repository_id: candidate.externalRepositoryId,
        owner: candidate.owner,
        name: candidate.name,
        origins: [candidate.origin],
      });
      continue;
    }

    if (!existing.origins.some((origin) => sameOrigin(origin, candidate.origin))) {
      existing.origins.push(candidate.origin);
    }
  }

  return [...rows.values()].sort(compareRows);
}

type RepositoryAccessCandidate = {
  externalRepositoryId: string;
  owner: string;
  name: string;
  origin: RepositoryAccessOrigin;
};

function compareCandidates(
  left: RepositoryAccessCandidate,
  right: RepositoryAccessCandidate,
): number {
  const cursorComparison = compareCursors(left, right);
  if (cursorComparison !== 0) return cursorComparison;
  return originOrder(left.origin) - originOrder(right.origin);
}

function compareRows(left: RepositoryAccessRow, right: RepositoryAccessRow): number {
  return compareCursors(
    {
      owner: left.owner,
      name: left.name,
      externalRepositoryId: left.external_repository_id,
    },
    {
      owner: right.owner,
      name: right.name,
      externalRepositoryId: right.external_repository_id,
    },
  );
}

function compareCursors(left: RepositoryAccessCursor, right: RepositoryAccessCursor): number {
  const ownerComparison = compareFoldedStrings(left.owner, right.owner);
  if (ownerComparison !== 0) return ownerComparison;
  const nameComparison = compareFoldedStrings(left.name, right.name);
  if (nameComparison !== 0) return nameComparison;
  return compareStrings(left.externalRepositoryId, right.externalRepositoryId);
}

function compareFoldedStrings(left: string, right: string): number {
  return compareStrings(left.toLowerCase(), right.toLowerCase());
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function originOrder(origin: RepositoryAccessOrigin): number {
  return origin.type === 'project' ? 0 : 1;
}

function sameOrigin(left: RepositoryAccessOrigin, right: RepositoryAccessOrigin): boolean {
  if (left.type === 'project' && right.type === 'project') {
    return left.project_id === right.project_id;
  }
  if (left.type === 'manual' && right.type === 'manual') {
    return left.grant_id === right.grant_id;
  }
  return false;
}

function projectCursor(project: ProjectRepository): RepositoryAccessCursor {
  return {
    owner: project.owner,
    name: project.name,
    externalRepositoryId: project.externalRepositoryId,
  };
}

function grantCursor(grant: IntegrationConnectionRepositoryGrant): RepositoryAccessCursor {
  return {
    owner: grant.repositoryOwner,
    name: grant.repositoryName,
    externalRepositoryId: grant.externalRepositoryId,
  };
}

function isAfterCursor(
  value: RepositoryAccessCursor,
  cursor: RepositoryAccessCursor | undefined,
): boolean {
  return cursor === undefined || compareCursors(value, cursor) > 0;
}

function encodeRepositoryAccessCursor(cursor: RepositoryAccessCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeRepositoryAccessCursor(
  cursor: string | undefined,
): RepositoryAccessCursor | undefined {
  if (!cursor) return undefined;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const candidate = parsed as Partial<RepositoryAccessCursor>;
    if (
      typeof candidate.owner !== 'string' ||
      candidate.owner.length === 0 ||
      typeof candidate.name !== 'string' ||
      candidate.name.length === 0 ||
      typeof candidate.externalRepositoryId !== 'string' ||
      candidate.externalRepositoryId.length === 0
    ) {
      return undefined;
    }
    return {
      owner: candidate.owner,
      name: candidate.name,
      externalRepositoryId: candidate.externalRepositoryId,
    };
  } catch {
    return undefined;
  }
}

function validateExternalRepositoryId(
  externalRepositoryId: string,
  provider: string,
  repositoryOwner: string,
  repositoryName: string,
): void {
  try {
    const providerRepositoryId = parseProviderRepositoryId(externalRepositoryId, provider);
    if (
      providerRepositoryId.includes('/') &&
      providerRepositoryId.toLowerCase() !== `${repositoryOwner}/${repositoryName}`.toLowerCase()
    ) {
      throw new Error('Provider repository id does not match repository coordinates');
    }
  } catch {
    throw new ClientError('Invalid provider-namespaced repository id', 'invalid-repository', {
      status: 400,
    });
  }
}

function invalidate(
  invalidateRepositoryAuthorizationCache: ((connectionId: string) => void) | undefined,
  connectionId: string,
): void {
  invalidateRepositoryAuthorizationCache?.(connectionId);
}

function connectionNotFound(): ClientError {
  return new ClientError('Integration connection not found', 'integration-connection-not-found', {
    status: 404,
  });
}
