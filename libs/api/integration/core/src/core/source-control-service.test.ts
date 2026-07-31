import {IntegrationCheckoutUnsupportedError, IntegrationProviderError} from './errors.js';
import {createIntegrationProviderRegistry} from './providers/registry.js';
import type {RepositorySnapshot, SourceControlProvider} from './providers/source-control.js';
import {createSourceControlIntegrationService} from './source-control-service.js';

const repository: RepositorySnapshot = {
  externalRepositoryId: 'gitea:gitea-owner/platform',
  owner: 'gitea-owner',
  name: 'platform',
  fullName: 'gitea-owner/platform',
  defaultBranch: 'main',
  visibility: 'private',
  cloneUrl: 'https://gitea.local/gitea-owner/platform.git',
  htmlUrl: 'https://gitea.local/gitea-owner/platform',
};

describe('integration source-control service', () => {
  const workspaceId = crypto.randomUUID();
  const connection = {
    id: crypto.randomUUID(),
    workspaceId,
    provider: 'gitea' as const,
    externalAccountId: 'gitea-owner',
    slug: 'gitea_owner',
    displayName: 'Gitea',
    lifecycleStatus: 'active' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function createService(
    overrides: Partial<SourceControlProvider> = {},
    options: {omitCheckoutSpec?: boolean} = {},
  ) {
    const sourceControl: SourceControlProvider = {
      listRepositories: async () => {
        await Promise.resolve();
        return {repositories: [repository], nextCursor: null};
      },
      resolveRepository: async () => {
        await Promise.resolve();
        return repository;
      },
      listFiles: async () => {
        await Promise.resolve();
        return {
          files: [{path: '.shipfox/workflows/ci.yml', type: 'file', size: 64}],
          nextCursor: null,
        };
      },
      fetchFile: async () => {
        await Promise.resolve();
        return {path: '.shipfox/workflows/ci.yml', ref: 'main', content: 'name: CI'};
      },
      resolveTriggerReference: () => null,
      createCheckoutSpec: async (input) => {
        await Promise.resolve();
        return {repositoryUrl: repository.cloneUrl, ref: input.ref ?? repository.defaultBranch};
      },
      ...overrides,
    };
    if (options.omitCheckoutSpec) {
      delete sourceControl.createCheckoutSpec;
    }
    return createSourceControlIntegrationService({
      registry: createIntegrationProviderRegistry([
        {
          provider: 'gitea',
          displayName: 'Gitea',
          adapters: {
            source_control: sourceControl,
          },
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
      externalRepositoryId: 'gitea:gitea-owner/platform',
    });

    expect(result.connection.id).toBe(connection.id);
    expect(result.repository.externalRepositoryId).toBe('gitea:gitea-owner/platform');
  });

  it('resolves a normalized trigger reference through an active source-control connection', async () => {
    const resolveTriggerReference = vi.fn(() => ({
      externalRepositoryId: repository.externalRepositoryId,
      ref: 'refs/heads/main',
      commit: 'a'.repeat(40),
    }));
    const service = createService({resolveTriggerReference});

    await expect(
      service.resolveTriggerReference({
        workspaceId,
        connectionId: connection.id,
        payload: {ref: 'refs/heads/main'},
      }),
    ).resolves.toEqual({
      externalRepositoryId: repository.externalRepositoryId,
      ref: 'refs/heads/main',
      commit: 'a'.repeat(40),
    });
    expect(resolveTriggerReference).toHaveBeenCalledWith({ref: 'refs/heads/main'});
  });

  it('rejects a missing connection', async () => {
    const service = createService();

    const result = service.resolveRepository({
      workspaceId,
      connectionId: crypto.randomUUID(),
      externalRepositoryId: 'gitea:gitea-owner/platform',
    });

    await expect(result).rejects.toThrow('Integration connection not found');
  });

  it('rejects a connection in another workspace', async () => {
    const service = createService();

    const result = service.resolveRepository({
      workspaceId: crypto.randomUUID(),
      connectionId: connection.id,
      externalRepositoryId: 'gitea:gitea-owner/platform',
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
      externalRepositoryId: 'gitea:gitea-owner/missing',
    });

    await expect(result).rejects.toMatchObject({reason: 'repository-not-found'});
  });

  it('lists files through an active source-control connection', async () => {
    const service = createService();

    const result = await service.listFiles({
      workspaceId,
      connectionId: connection.id,
      externalRepositoryId: 'gitea:gitea-owner/platform',
      ref: 'main',
      prefix: '.shipfox/workflows/',
      limit: 100,
    });

    expect(result.files[0]?.path).toBe('.shipfox/workflows/ci.yml');
  });

  it('fetches files through an active source-control connection', async () => {
    const service = createService();

    const result = await service.fetchFile({
      workspaceId,
      connectionId: connection.id,
      externalRepositoryId: 'gitea:gitea-owner/platform',
      ref: 'main',
      path: '.shipfox/workflows/ci.yml',
    });

    expect(result.content).toBe('name: CI');
  });

  it('creates a checkout spec through an active source-control connection', async () => {
    const createCheckoutSpec = vi.fn(
      async (input: Parameters<NonNullable<SourceControlProvider['createCheckoutSpec']>>[0]) => {
        await Promise.resolve();
        return {repositoryUrl: repository.cloneUrl, ref: input.ref ?? repository.defaultBranch};
      },
    );
    const service = createService({createCheckoutSpec});

    const result = await service.createCheckoutSpec({
      workspaceId,
      connectionId: connection.id,
      externalRepositoryId: 'gitea:gitea-owner/platform',
      ref: 'feature/x',
      permissions: {contents: 'write'},
    });

    expect(result).toEqual({
      repositoryUrl: 'https://gitea.local/gitea-owner/platform.git',
      ref: 'feature/x',
    });
    expect(createCheckoutSpec).toHaveBeenCalledWith(
      expect.objectContaining({permissions: {contents: 'write'}}),
    );
  });

  it('rejects a checkout spec for a connection in another workspace', async () => {
    const service = createService();

    const result = service.createCheckoutSpec({
      workspaceId: crypto.randomUUID(),
      connectionId: connection.id,
      externalRepositoryId: 'gitea:gitea-owner/platform',
    });

    await expect(result).rejects.toThrow('requested workspace');
  });

  it('surfaces provider checkout failures', async () => {
    const service = createService({
      createCheckoutSpec: async () => {
        await Promise.resolve();
        throw new IntegrationProviderError('access-denied', 'Checkout not permitted');
      },
    });

    const result = service.createCheckoutSpec({
      workspaceId,
      connectionId: connection.id,
      externalRepositoryId: 'gitea:gitea-owner/platform',
    });

    await expect(result).rejects.toMatchObject({reason: 'access-denied'});
  });

  it('rejects when the provider does not support creating a checkout spec', async () => {
    const service = createService({}, {omitCheckoutSpec: true});

    const result = service.createCheckoutSpec({
      workspaceId,
      connectionId: connection.id,
      externalRepositoryId: 'gitea:gitea-owner/platform',
    });

    await expect(result).rejects.toBeInstanceOf(IntegrationCheckoutUnsupportedError);
  });
});
