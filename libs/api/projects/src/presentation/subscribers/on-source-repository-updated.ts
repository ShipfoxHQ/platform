import type {IntegrationSourceRepositoryUpdatedEvent} from '@shipfox/api-integration-core-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {DomainEvent} from '@shipfox/node-outbox';
import {updateProjectSourceRepository} from '#db/projects.js';

export async function onSourceRepositoryUpdated(
  payload: IntegrationSourceRepositoryUpdatedEvent,
  event: DomainEvent<IntegrationSourceRepositoryUpdatedEvent>,
): Promise<void> {
  const project = await updateProjectSourceRepository({
    workspaceId: payload.workspaceId,
    sourceConnectionId: payload.connectionId,
    sourceExternalRepositoryId: payload.repository.externalRepositoryId,
    sourceRepositoryOwner: payload.repository.owner,
    sourceRepositoryName: payload.repository.name,
    sourceDefaultBranch: payload.repository.defaultBranch,
  });

  if (project) return;

  logger().info(
    {
      eventId: event.id,
      connectionId: payload.connectionId,
      externalRepositoryId: payload.repository.externalRepositoryId,
    },
    'source repository updated: no project bound to source, dropping',
  );
}
