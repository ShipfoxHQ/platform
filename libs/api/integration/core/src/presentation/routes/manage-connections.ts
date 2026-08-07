import {AUTH_USER, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  integrationConnectionDtoSchema,
  updateIntegrationConnectionBodySchema,
} from '@shipfox/api-integration-spi';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import {processIntegrationSecretCleanups} from '#core/secret-cleanup.js';
import {
  deleteIntegrationConnection,
  getIntegrationConnectionById,
  updateIntegrationConnectionLifecycleStatus,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {enqueueIntegrationSecretCleanup} from '#db/secret-cleanups.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';

const connectionParamsSchema = z.object({
  connectionId: z.string().uuid(),
});

export function createUpdateIntegrationConnectionRoute(registry: IntegrationProviderRegistry) {
  return defineRoute({
    method: 'PATCH',
    path: '/integration-connections/:connectionId',
    auth: AUTH_USER,
    description: 'Update an integration connection.',
    schema: {
      params: connectionParamsSchema,
      body: updateIntegrationConnectionBodySchema,
      response: {
        200: integrationConnectionDtoSchema,
      },
    },
    handler: async (request) => {
      const connection = await getIntegrationConnectionById(request.params.connectionId);
      if (!connection) {
        throw new ClientError('Integration connection not found', 'not-found', {status: 404});
      }

      requireWorkspaceAccess({request, workspaceId: connection.workspaceId});
      const updated = await updateIntegrationConnectionLifecycleStatus({
        id: connection.id,
        lifecycleStatus: request.body.lifecycle_status,
      });
      if (!updated) {
        throw new ClientError('Integration connection not found', 'not-found', {status: 404});
      }

      const provider = registry.list().find((candidate) => candidate.provider === updated.provider);
      return toIntegrationConnectionDto(updated, {capabilities: provider?.capabilities ?? []});
    },
  });
}

export function createDeleteIntegrationConnectionRoute(registry: IntegrationProviderRegistry) {
  return defineRoute({
    method: 'DELETE',
    path: '/integration-connections/:connectionId',
    auth: AUTH_USER,
    description: 'Delete an integration connection.',
    schema: {
      params: connectionParamsSchema,
      response: {
        204: z.void(),
      },
    },
    handler: async (request, reply) => {
      const connection = await getIntegrationConnectionById(request.params.connectionId);
      if (!connection) {
        throw new ClientError('Integration connection not found', 'not-found', {status: 404});
      }

      requireWorkspaceAccess({request, workspaceId: connection.workspaceId});
      const provider = registry
        .list()
        .find((candidate) => candidate.provider === connection.provider);
      const hasCleanupHooks =
        provider?.deleteConnectionRemoteResources !== undefined ||
        provider?.deleteConnectionRecords !== undefined ||
        provider?.deleteConnectionSecrets !== undefined;
      if (!hasCleanupHooks) {
        request.log.warn(
          {connectionId: connection.id, provider: connection.provider},
          'Deleting integration connection without provider cleanup',
        );
      }
      const deleteConnection = async (): Promise<void> => {
        let deleteRemoteResources: (() => Promise<void>) | undefined;
        try {
          deleteRemoteResources = await provider?.deleteConnectionRemoteResources?.(connection);
        } catch (error) {
          request.log.error(
            {connectionId: connection.id, provider: connection.provider, err: error},
            'Integration connection remote cleanup preparation failed',
          );
        }
        await db().transaction(async (tx) => {
          await provider?.deleteConnectionRecords?.(connection, {tx});
          await enqueueIntegrationSecretCleanup({connection}, {tx});
          await deleteIntegrationConnection({id: connection.id}, {tx});
        });
        try {
          await deleteRemoteResources?.();
        } catch (error) {
          request.log.error(
            {connectionId: connection.id, provider: connection.provider, err: error},
            'Integration connection remote cleanup failed after deletion',
          );
        }
        try {
          await processIntegrationSecretCleanups({
            registry,
            connectionId: connection.id,
            connection,
            limit: 1,
          });
        } catch (error) {
          // The durable cleanup row survives, so a later sweep retries this connection.
          request.log.error(
            {connectionId: connection.id, provider: connection.provider, err: error},
            'Integration connection secret cleanup failed after connection deletion',
          );
        }
      };
      if (provider?.withConnectionDeletionLock) {
        await provider.withConnectionDeletionLock(connection, deleteConnection);
      } else {
        await deleteConnection();
      }
      reply.status(204);
    },
  });
}
