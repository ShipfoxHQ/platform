import {
  CONNECTION_REPOSITORY_ACCESS_CHANGED,
  CONNECTION_REPOSITORY_GRANTED,
  CONNECTION_REPOSITORY_REVOKED,
  type IntegrationsEventMap,
} from '@shipfox/api-integration-core-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import type {IntegrationConnection} from '#core/entities/connection.js';
import type {IntegrationConnectionRepositoryGrant} from '#core/entities/repository-grant.js';
import {
  type UpdateIntegrationConnectionRepositoryAccessModeParams,
  updateIntegrationConnectionRepositoryAccessMode,
} from './connections.js';
import {db} from './db.js';
import {
  type DeleteIntegrationConnectionRepositoryGrantByIdParams,
  deleteIntegrationConnectionRepositoryGrantById,
  type UpsertIntegrationConnectionRepositoryGrantParams,
  upsertIntegrationConnectionRepositoryGrant,
} from './repository-grants.js';
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

export async function upsertIntegrationConnectionRepositoryGrantWithAudit(
  params: UpsertIntegrationConnectionRepositoryGrantParams & RepositoryAccessAuditContext,
): Promise<IntegrationConnectionRepositoryGrant | undefined> {
  return await db().transaction(async (tx) => {
    const grant = await upsertIntegrationConnectionRepositoryGrant(params, {tx});
    if (!grant) return undefined;

    await writeOutboxEvent<IntegrationsEventMap>(tx, integrationsOutbox, {
      type: CONNECTION_REPOSITORY_GRANTED,
      payload: {
        actorId: params.actorId,
        workspaceId: grant.workspaceId,
        connectionId: grant.connectionId,
        provider: params.provider,
        grantId: grant.id,
        externalRepositoryId: grant.externalRepositoryId,
        repositoryOwner: grant.repositoryOwner,
        repositoryName: grant.repositoryName,
        correlationId: params.correlationId,
        occurredAt: new Date().toISOString(),
      },
    });
    return grant;
  });
}

export async function deleteIntegrationConnectionRepositoryGrantByIdWithAudit(
  params: DeleteIntegrationConnectionRepositoryGrantByIdParams & RepositoryAccessAuditContext,
): Promise<IntegrationConnectionRepositoryGrant | undefined> {
  return await db().transaction(async (tx) => {
    const grant = await deleteIntegrationConnectionRepositoryGrantById(params, {tx});
    if (!grant) return undefined;

    await writeOutboxEvent<IntegrationsEventMap>(tx, integrationsOutbox, {
      type: CONNECTION_REPOSITORY_REVOKED,
      payload: {
        actorId: params.actorId,
        workspaceId: grant.workspaceId,
        connectionId: grant.connectionId,
        provider: params.provider,
        grantId: grant.id,
        externalRepositoryId: grant.externalRepositoryId,
        repositoryOwner: grant.repositoryOwner,
        repositoryName: grant.repositoryName,
        correlationId: params.correlationId,
        occurredAt: new Date().toISOString(),
      },
    });
    return grant;
  });
}
