import {
  AUTH_USER,
  rejectImpersonatedSession,
  requireWorkspaceAccess,
} from '@shipfox/api-auth-context';
import {
  integrationConnectionRepositoryAccessResponseSchema,
  listIntegrationConnectionRepositoryAccessQuerySchema,
  updateIntegrationConnectionRepositoryAccessBodySchema,
  updateIntegrationConnectionRepositoryAccessResponseSchema,
} from '@shipfox/api-integration-spi';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError, defineRoute, type RouteExport} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import type {IntegrationConnection} from '#core/entities/connection.js';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import {
  type ListSelectedRepositoryAccessResult,
  listSelectedRepositoryAccess,
  type RepositoryAccessCursor,
} from '#core/repository-access-read.js';
import {getIntegrationConnectionById} from '#db/connections.js';
import {updateIntegrationConnectionRepositoryAccessModeWithAudit} from '#db/repository-access.js';
import {toRepositoryAccessRepositoryDto} from '#presentation/dto/integrations.js';
import {integrationRouteErrorHandler} from './errors.js';

const connectionParamsSchema = z.object({
  connectionId: z.string().uuid(),
});

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
    description: 'Read project-backed repository access for an integration connection.',
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
        throw new ClientError('Projects module is unavailable', 'projects-module-unavailable', {
          status: 503,
        });
      }

      const result: ListSelectedRepositoryAccessResult = await listSelectedRepositoryAccess({
        connection,
        projects: params.projects,
        limit: request.query.limit,
        cursor,
      });
      return {
        mode: connection.repositoryAccessMode,
        repositories: result.repositories.map(toRepositoryAccessRepositoryDto),
        next_cursor: result.nextCursor ? encodeRepositoryAccessCursor(result.nextCursor) : null,
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

  return [updateModeRoute];
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
