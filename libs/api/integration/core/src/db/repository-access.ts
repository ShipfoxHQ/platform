import {
  CONNECTION_REPOSITORY_ACCESS_CHANGED,
  type IntegrationsEventMap,
} from '@shipfox/api-integration-core-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import type {IntegrationConnection} from '#core/entities/connection.js';
import {
  type UpdateIntegrationConnectionRepositoryAccessModeParams,
  updateIntegrationConnectionRepositoryAccessMode,
} from './connections.js';
import {db} from './db.js';
import {integrationsOutbox} from './schema/outbox.js';

interface RepositoryAccessAuditContext {
  actorId: string;
  correlationId: string;
  provider: string;
}

export async function updateIntegrationConnectionRepositoryAccessModeWithAudit(
  params: UpdateIntegrationConnectionRepositoryAccessModeParams & RepositoryAccessAuditContext,
): Promise<IntegrationConnection | undefined> {
  return await db().transaction(async (tx) => {
    const connection = await updateIntegrationConnectionRepositoryAccessMode(params, {tx});
    if (!connection) return undefined;

    await writeOutboxEvent<IntegrationsEventMap>(tx, integrationsOutbox, {
      type: CONNECTION_REPOSITORY_ACCESS_CHANGED,
      orderingKey: connection.id,
      payload: {
        actorId: params.actorId,
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        provider: connection.provider,
        mode: connection.repositoryAccessMode,
        correlationId: params.correlationId,
        occurredAt: new Date().toISOString(),
      },
    });
    return connection;
  });
}
