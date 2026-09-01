import {
  AUTH_USER,
  rejectImpersonatedSession,
  requireWorkspaceAccess,
} from '@shipfox/api-auth-context';
import {
  createIntegrationConnectionRepositoryGrantBodySchema,
  integrationConnectionRepositoryGrantDtoSchema,
  parseProviderRepositoryId,
  updateIntegrationConnectionRepositoryAccessBodySchema,
  updateIntegrationConnectionRepositoryAccessResponseSchema,
} from '@shipfox/api-integration-spi';
import {ClientError, defineRoute, type RouteExport} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import type {IntegrationConnection} from '#core/entities/connection.js';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import {getIntegrationConnectionById} from '#db/connections.js';
import {
  deleteIntegrationConnectionRepositoryGrantByIdWithAudit,
  updateIntegrationConnectionRepositoryAccessModeWithAudit,
  upsertIntegrationConnectionRepositoryGrantWithAudit,
} from '#db/repository-access.js';
import {toRepositoryGrantDto} from '#presentation/dto/integrations.js';
import {integrationRouteErrorHandler} from './errors.js';

const connectionParamsSchema = z.object({
  connectionId: z.string().uuid(),
});

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
