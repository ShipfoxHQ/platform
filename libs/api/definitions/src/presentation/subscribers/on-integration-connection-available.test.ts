import type {IntegrationConnectionAvailableEvent} from '@shipfox/api-integration-core-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {createOnIntegrationConnectionAvailable} from './on-integration-connection-available.js';

const startMock = vi.fn();

vi.mock('@shipfox/node-temporal', () => ({
  temporalClient: () => ({workflow: {start: startMock}}),
}));

function project(name: string, workspaceId: string) {
  return {
    id: crypto.randomUUID(),
    workspaceId,
    sourceConnectionId: crypto.randomUUID(),
    sourceExternalRepositoryId: `github:${name}`,
    sourceRepositoryOwner: 'shipfox',
    name,
  };
}

describe('onIntegrationConnectionAvailable', () => {
  beforeEach(() => {
    startMock.mockReset();
    startMock.mockResolvedValue({});
  });

  it('paginates workspace projects and starts an event-keyed sync for each one', async () => {
    const workspaceId = crypto.randomUUID();
    const first = project('first', workspaceId);
    const second = project('second', workspaceId);
    const cursor = {createdAt: '2026-08-05T12:00:00.000Z', id: first.id};
    const listProjectsByWorkspace = vi
      .fn()
      .mockResolvedValueOnce({projects: [first], nextCursor: cursor})
      .mockResolvedValueOnce({projects: [second], nextCursor: null});
    const handler = createOnIntegrationConnectionAvailable({listProjectsByWorkspace} as never);
    const payload: IntegrationConnectionAvailableEvent = {
      provider: 'linear',
      workspaceId: first.workspaceId,
      connectionId: crypto.randomUUID(),
      slug: 'linear_shipfox',
    };
    const event: DomainEvent<IntegrationConnectionAvailableEvent> = {
      id: crypto.randomUUID(),
      type: 'integrations.connection.available',
      payload,
      createdAt: new Date(),
    };

    await handler(payload, event);

    expect(listProjectsByWorkspace).toHaveBeenNthCalledWith(1, {
      workspaceId: payload.workspaceId,
      limit: 100,
    });
    expect(listProjectsByWorkspace).toHaveBeenNthCalledWith(2, {
      workspaceId: payload.workspaceId,
      limit: 100,
      cursor,
    });
    expect(startMock).toHaveBeenCalledTimes(2);
    for (const candidate of [first, second]) {
      expect(startMock).toHaveBeenCalledWith('definitionSyncWorkflow', {
        taskQueue: 'definitions-sync',
        workflowId: `definition-sync:${candidate.id}:integration:${event.id}`,
        workflowIdConflictPolicy: 'USE_EXISTING',
        workflowIdReusePolicy: 'ALLOW_DUPLICATE',
        args: [
          {
            projectId: candidate.id,
            workspaceId: candidate.workspaceId,
            sourceConnectionId: candidate.sourceConnectionId,
            sourceExternalRepositoryId: candidate.sourceExternalRepositoryId,
            sourceRef: undefined,
            sourceCommitSha: undefined,
          },
        ],
      });
    }
  });

  it('rethrows project lookup failures so the outbox event can retry', async () => {
    const failure = new Error('projects unavailable');
    const handler = createOnIntegrationConnectionAvailable({
      listProjectsByWorkspace: vi.fn(() => Promise.reject(failure)),
    } as never);
    const payload: IntegrationConnectionAvailableEvent = {
      provider: 'linear',
      workspaceId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      slug: 'linear_shipfox',
    };

    await expect(
      handler(payload, {
        id: crypto.randomUUID(),
        type: 'integrations.connection.available',
        payload,
        createdAt: new Date(),
      }),
    ).rejects.toBe(failure);
  });
});
