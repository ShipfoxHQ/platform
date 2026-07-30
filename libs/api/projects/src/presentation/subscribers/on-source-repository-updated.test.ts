import {
  INTEGRATION_SOURCE_REPOSITORY_UPDATED,
  type IntegrationSourceRepositoryUpdatedEvent,
} from '@shipfox/api-integration-core-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {getProjectBySource} from '#db/index.js';
import {projectFactory} from '#test/index.js';
import {onSourceRepositoryUpdated} from './on-source-repository-updated.js';

function buildEvent(params: {
  workspaceId: string;
  connectionId: string;
  externalRepositoryId: string;
}): DomainEvent<IntegrationSourceRepositoryUpdatedEvent> {
  return {
    id: crypto.randomUUID(),
    type: INTEGRATION_SOURCE_REPOSITORY_UPDATED,
    createdAt: new Date(),
    payload: {
      provider: 'github',
      workspaceId: params.workspaceId,
      connectionId: params.connectionId,
      deliveryId: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      repository: {
        externalRepositoryId: params.externalRepositoryId,
        owner: 'acme',
        name: 'platform-renamed',
        defaultBranch: 'trunk',
      },
    },
  };
}

describe('onSourceRepositoryUpdated', () => {
  it('refreshes the denormalized repository identity by stable external id', async () => {
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const externalRepositoryId = `github:${crypto.randomUUID()}`;
    const project = await projectFactory.create({
      workspaceId,
      sourceConnectionId: connectionId,
      sourceExternalRepositoryId: externalRepositoryId,
      sourceRepositoryOwner: 'old-owner',
      sourceRepositoryName: 'old-name',
      sourceDefaultBranch: 'main',
    });
    const event = buildEvent({workspaceId, connectionId, externalRepositoryId});

    await onSourceRepositoryUpdated(event.payload, event);

    const refreshed = await getProjectBySource({
      workspaceId,
      sourceConnectionId: connectionId,
      sourceExternalRepositoryId: externalRepositoryId,
    });
    expect(refreshed).toMatchObject({
      id: project.id,
      sourceRepositoryOwner: 'acme',
      sourceRepositoryName: 'platform-renamed',
      sourceDefaultBranch: 'trunk',
    });
  });

  it('ignores updates for repositories without a bound project', async () => {
    const event = buildEvent({
      workspaceId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      externalRepositoryId: `github:${crypto.randomUUID()}`,
    });

    await expect(onSourceRepositoryUpdated(event.payload, event)).resolves.toBeUndefined();
  });
});
