import {IntegrationProviderError} from './errors.js';
import {createIntegrationProviderRegistry} from './providers/registry.js';
import type {RepositorySnapshot, SourceControlProvider} from './providers/source-control.js';
import {createIntegrationSourceControlService} from './source-control-service.js';

const repository: RepositorySnapshot = {
  externalRepositoryId: 'platform',
  owner: 'debug-owner',
  name: 'platform',
  fullName: 'debug-owner/platform',
  defaultBranch: 'main',
  visibility: 'private',
  cloneUrl: 'https://debug.local/debug-owner/platform.git',
  htmlUrl: 'https://debug.local/debug-owner/platform',
};

describe('integration source-control service', () => {
  const workspaceId = crypto.randomUUID();
  const connection = {
    id: crypto.randomUUID(),
    workspaceId,
    provider: 'debug' as const,
    externalAccountId: 'debug',
    displayName: 'Debug',
    lifecycleStatus: 'active' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function createService(overrides: Partial<SourceControlProvider> = {}) {
    const sourceControl: SourceControlProvider = {
      listRepositories: async () => {
        await Promise.resolve();
        return {repositories: [repository], nextCursor: null};
      },
      resolveRepository: async () => {
        await Promise.resolve();
        return repository;
      },
      ...overrides,
    };
    return createIntegrationSourceControlService({
      registry: createIntegrationProviderRegistry([
        {
          provider: 'debug',
          displayName: 'Debug',
          capabilities: ['source_control'],
          sourceControl,
        },
      ]),
      getIntegrationConnectionById: async (connectionId) => {
        await Promise.resolve();
        return connectionId === connection.id ? connection : undefined;
      },
    });
  }

  it('resolves a repository through an active source-control connection', async () => {
    const service = createService();

    const result = await service.resolveRepository({
      workspaceId,
      connectionId: connection.id,
      externalRepositoryId: 'platform',
    });

    expect(result.connection.id).toBe(connection.id);
    expect(result.repository.externalRepositoryId).toBe('platform');
  });

  it('rejects a missing connection', async () => {
    const service = createService();

    const result = service.resolveRepository({
      workspaceId,
      connectionId: crypto.randomUUID(),
      externalRepositoryId: 'platform',
    });

    await expect(result).rejects.toThrow('Integration connection not found');
  });

  it('rejects a connection in another workspace', async () => {
    const service = createService();

    const result = service.resolveRepository({
      workspaceId: crypto.randomUUID(),
      connectionId: connection.id,
      externalRepositoryId: 'platform',
    });

    await expect(result).rejects.toThrow('requested workspace');
  });

  it('surfaces provider repository failures', async () => {
    const service = createService({
      resolveRepository: async () => {
        await Promise.resolve();
        throw new IntegrationProviderError('repository-not-found', 'Repository not found');
      },
    });

    const result = service.resolveRepository({
      workspaceId,
      connectionId: connection.id,
      externalRepositoryId: 'missing',
    });

    await expect(result).rejects.toMatchObject({reason: 'repository-not-found'});
  });
});
